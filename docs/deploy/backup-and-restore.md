# Backup and restore (EC2 -> Google Drive, age-encrypted)

Spec: `docs/specs/db-source-of-truth-backup.md`. Hebrew-friendly notes in parentheses where useful.

## What runs, and when (UTC, on the EC2 host crontab)

| Time | Script | What it does |
|---|---|---|
| 01:00 daily | `scripts/backup-daily.sh` | `VACUUM INTO` snapshot, `integrity_check`, row-count sanity (>20% drop = failure), tar of `abc-data` + `bridge-config` (not `bridge-auth`), gzip, **age** encrypt, keep 7 locally in `/opt/ak-backups`, `rclone copy` to `akdrive:AK_system_backups`, prune Drive to 14 daily + 8 weekly (Sundays) + 12 monthly (1st), POST to `/api/cron/backup-report` |
| 01:30 daily | `scripts/backup-audio.sh` | encrypt each voice recording once, upload once to `AK_system_backups/audio/` (local manifest `/opt/ak-backups/audio-manifest.tsv`) |
| 02:00 on the 1st | `scripts/audio-cleanup-monthly.sh` | delete audio older than 30 days from EC2 **and** Drive, only if the recording's analysis is complete |
| each deploy | `scripts/backup-daily.sh --predeploy` (from `deploy-ec2.sh`) | local-only encrypted snapshot before `docker compose up` (keeps 3) |
| weekly (AWS) | DLM EBS snapshot | second, independent layer (see below) |

Failures (including a crash anywhere in a script) are reported with `status: failed` and trigger the Telegram alert in the app. The app's dead-man's switch alerts when no successful `daily` run was reported for 26 h (cron dead, host down, Drive token revoked).

Audio cleanup deletes only when ALL hold: `voice_recordings.status='completed'`, `diarization_status<>'pending'`, `voice_recordings.analysis_id` points to a `meeting_analyses` row with `status='completed'`, and `voice_recordings.created_at` is older than 30 days. Transcripts, analyses and the DB are untouched. The `voice_recordings.audio_path` column is **left as is** (it points at a file that no longer exists; the UI must tolerate that). Use `bash scripts/audio-cleanup-monthly.sh --dry-run` first.

## One-time setup

### 1. Google Cloud OAuth client (Drive API, `drive.file` only)

1. https://console.cloud.google.com -> create a project (e.g. `ak-system-backup`).
2. **APIs & Services -> Library -> Google Drive API -> Enable.**
3. **OAuth consent screen**: user type External, app name `AK System Backup`, your email. Under **Scopes** add only `.../auth/drive.file` (non-sensitive).
4. **Publishing status: click "Publish app" so it is "In production".** If it stays in *Testing*, the refresh token **expires after 7 days** and backups silently start failing. Unverified is fine for a single personal user (you will see an "unverified app" warning once during consent).
5. **Credentials -> Create credentials -> OAuth client ID -> Desktop app.** Note the client ID and secret.

### 2. rclone remote `akdrive` (scope `drive.file`)

Do the interactive OAuth on the Mac (it has a browser), then copy the config to the server:

```bash
brew install rclone
rclone config
#  n) New remote       name> akdrive       Storage> drive
#  client_id> <your id>   client_secret> <your secret>
#  scope> 3   (drive.file - "Access to files created by rclone only")
#  root_folder_id> (leave empty)   service_account_file> (empty)
#  Edit advanced config? n   Use web browser to authenticate? y   Configure as team drive? n
rclone config show akdrive          # confirm  scope = drive.file
rclone mkdir akdrive:AK_system_backups
rclone lsd akdrive:                 # should list ONLY AK_system_backups, nothing else from your Drive
```

`drive.file` means the token only sees files/folders created by this client; rclone creates `AK_system_backups` itself (a pre-existing hand-made folder is invisible to it). Copy the config to the server and lock it down:

```bash
scp ~/.config/rclone/rclone.conf ubuntu@<EC2>:/opt/ak-system/rclone.conf
ssh ubuntu@<EC2> 'chmod 600 /opt/ak-system/rclone.conf'
```

The deploy rsync excludes `/rclone.conf` and `/backup.age.pub`, so deploys never delete them. Never commit them.

### 3. age keypair (private key NEVER on the server)

On the Mac:

```bash
brew install age
age-keygen -o ~/ak-backup.key          # prints:  Public key: age1....
chmod 600 ~/ak-backup.key
```

- Store `~/ak-backup.key` in your password manager **and** print a paper copy. Without it the backups are unreadable; with it lost, nothing can be recovered.
- Put only the public key on the server:

```bash
echo 'age1....YOUR_PUBLIC_KEY' | ssh ubuntu@<EC2> 'cat > /opt/ak-system/backup.age.pub'
```

### 4. Install tools on the EC2 Ubuntu host

```bash
sudo apt-get update && sudo apt-get install -y age sqlite3 rclone util-linux curl
# util-linux provides flock/ionice. If the apt rclone is too old for Drive: curl https://rclone.org/install.sh | sudo bash
age --version && rclone version | head -1 && sqlite3 --version
```

The scripts use `sudo -n` for docker volume access (`/var/lib/docker/volumes/...`); the default `ubuntu` user has passwordless sudo.

### 5. Install the cron jobs

`scripts/deploy-ec2.sh` runs `install-server-cron.sh` and then `install-backup-cron.sh` automatically. By hand:

```bash
ssh ubuntu@<EC2>
cd /opt/ak-system
bash scripts/backup-daily.sh          # first run by hand; check Drive for ak_system-YYYY-MM-DD.tar.gz.age
bash scripts/install-backup-cron.sh
crontab -l                            # shows the "ak-backup" managed block
```

Note: `install-server-cron.sh` replaces the whole crontab; always run it **before** `install-backup-cron.sh` (the deploy script does).

Memory: nothing here starts Node. Peak usage is sqlite3 `VACUUM INTO` plus a gzip/age pipe under `nice -n 19` / `ionice -c3`; expect well under 150 MB.

### 6. Weekly EBS snapshot via AWS Data Lifecycle Manager (keep 4)

Tag the instance's root volume once, then create a DLM policy (console: **EC2 -> Lifecycle Manager -> Create lifecycle policy**, or CLI):

```bash
VOL=$(aws ec2 describe-instances --instance-ids <i-xxxx> \
  --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text)
aws ec2 create-tags --resources "$VOL" --tags Key=Backup,Value=ak-system

aws dlm create-lifecycle-policy \
  --description "ak-system weekly EBS snapshot" --state ENABLED \
  --execution-role-arn arn:aws:iam::<ACCOUNT_ID>:role/AWSDataLifecycleManagerDefaultRole \
  --policy-details '{
    "PolicyType":"EBS_SNAPSHOT_MANAGEMENT","ResourceTypes":["VOLUME"],
    "TargetTags":[{"Key":"Backup","Value":"ak-system"}],
    "Schedules":[{"Name":"weekly","CreateRule":{"CronExpression":"cron(0 3 ? * SUN *)"},
                  "RetainRule":{"Count":4},"CopyTags":true}]}'
```

(If the role does not exist: `aws iam create-service-linked-role --aws-service-name dlm.amazonaws.com`, or let the console create the default role.) Cost is pennies per month for a small volume.

## Daily operations

- Logs: `/var/log/ak-backup/{daily,audio,audio-cleanup}.log` on the host.
- Local archives: `ls -lh /opt/ak-backups` (7 daily + 3 pre-deploy).
- A legitimate >20% row-count drop (e.g. intentional cleanup) fails the run on purpose; re-run once with `FORCE_COUNT_DROP=1 bash scripts/backup-daily.sh`.
- Override remote/paths with `RCLONE_REMOTE`, `BACKUP_DIR`, `DEPLOY_PATH`, `AGE_PUBKEY_FILE`, `RCLONE_CONFIG`.

## Restore

Needs the age **private key** (copy it to the server only for the duration of the restore and shred it after).

```bash
# 1. get an archive (Drive) - or use one in /opt/ak-backups
RCLONE_CONFIG=/opt/ak-system/rclone.conf rclone lsf akdrive:AK_system_backups/
RCLONE_CONFIG=/opt/ak-system/rclone.conf rclone copy akdrive:AK_system_backups/ak_system-2026-10-29.tar.gz.age /tmp/

# 2. restore (stops web, keeps the old DB as ak_system.sqlite.pre-restore, restarts web)
scp ~/ak-backup.key ubuntu@<EC2>:/tmp/ak-backup.key
ssh ubuntu@<EC2>
cd /opt/ak-system
bash scripts/restore-backup.sh /tmp/ak_system-2026-10-29.tar.gz.age --key /tmp/ak-backup.key --files
shred -u /tmp/ak-backup.key
```

- `--files` additionally restores `abc-data` and `bridge-config` (old copies kept as `*.pre-restore`). Omit it to restore only the database.
- `bridge-auth` is not in any backup: after a full restore, re-pair WhatsApp by scanning the QR on the bridge page.
- Rollback of a restore: stop web, `mv ak_system.sqlite.pre-restore ak_system.sqlite` in the `web-data` volume, start web.
- Restored audio: decrypt a file from `AK_system_backups/audio/` with `age -d -i ~/ak-backup.key -o file.webm file.webm.age` (only recordings younger than 30 days, or not yet cleaned up, exist there).
- Total loss of the instance: launch a new EC2 from an EBS snapshot (fastest), or provision fresh (`scripts/aws-provision-ec2.sh` / deploy), then restore from Drive as above.

## Restore drill (monthly, on the Mac)

```bash
brew install age rclone sqlite3        # once; rclone config copied/created as in step 2
bash scripts/verify-backup.sh --key ~/ak-backup.key
# or against a specific local file:
bash scripts/verify-backup.sh --key ~/ak-backup.key --archive ./ak_system-2026-10-29.tar.gz.age
```

It downloads the newest archive, checks sha256, decrypts, runs `PRAGMA integrity_check`, compares row counts with the counts recorded in the archive, and prints sanity queries. Expected last line: `RESTORE DRILL PASSED`. Record the first successful run in `reports/db-source-of-truth-backup.md` (acceptance criterion), and then monthly.

Also check once that the token is scoped correctly: `rclone lsd akdrive:` must show only `AK_system_backups`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Telegram: backup failed, `rclone` error `invalid_grant` | Consent screen still in *Testing* (7-day token) or token revoked. Publish to *In production*, re-run `rclone config reconnect akdrive:` on the Mac, copy `rclone.conf` again |
| `missing age public key` | `/opt/ak-system/backup.age.pub` absent (step 3) |
| `database not found` / `docker volume 'web-data' not found` | compose project/volume names differ; check `docker volume ls` |
| `row count dropped >20%` | investigate first; if intended `FORCE_COUNT_DROP=1` |
| "No backup in 26 h" alert | cron not installed (`crontab -l`), host down, or the scripts cannot reach `APP_URL`/`CRON_SECRET` |
