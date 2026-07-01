#!/usr/bin/env bash
# Provision a Free Tier EC2 instance for AK System (Ubuntu + Docker-ready).
# Prerequisites: AWS CLI configured (aws configure OR aws login).
#
# Usage: bash scripts/aws-provision-ec2.sh
# Env overrides: AWS_REGION (default us-east-1), KEY_NAME (default ak-system), INSTANCE_TYPE (default t3.micro)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

AWS_REGION="${AWS_REGION:-us-east-1}"
KEY_NAME="${KEY_NAME:-ak-system}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"
SG_NAME="${SG_NAME:-ak-system-web}"
TAG_NAME="${TAG_NAME:-ak-system}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/${KEY_NAME}.pem}"
EC2_ENV="$ROOT_DIR/deploy/ec2.env"

log() { echo ""; echo "━━ $* ━━"; }

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "✗  AWS credentials not configured."
  echo ""
  echo "   Run ONE of:"
  echo "     aws configure          # Access Key + Secret from IAM"
  echo "     aws login              # AWS SSO / browser login"
  echo ""
  echo "   Then re-run: bash scripts/aws-provision-ec2.sh"
  exit 1
fi

export AWS_DEFAULT_REGION="$AWS_REGION"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "✓  AWS account $ACCOUNT_ID region $AWS_REGION"

# ── Key pair ───────────────────────────────────────────────────────────────────
log "SSH key pair: $KEY_NAME"
mkdir -p "$(dirname "$SSH_KEY_PATH")"
AWS_HAS_KEY=0
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  AWS_HAS_KEY=1
  echo "✓  Key pair exists in AWS"
fi

if [ "$AWS_HAS_KEY" -eq 1 ] && [ ! -f "$SSH_KEY_PATH" ]; then
  echo "✗  Key pair '$KEY_NAME' exists in AWS but $SSH_KEY_PATH is missing."
  echo "   Download the .pem from when you created it, or:"
  echo "     aws ec2 delete-key-pair --key-name $KEY_NAME"
  echo "   Then re-run this script to create a fresh key pair."
  exit 1
fi

if [ "$AWS_HAS_KEY" -eq 0 ] && [ -f "$SSH_KEY_PATH" ] && [ -s "$SSH_KEY_PATH" ]; then
  echo "→ Local key exists but not in AWS — importing public key"
  PUB_KEY="$(ssh-keygen -y -f "$SSH_KEY_PATH")"
  aws ec2 import-key-pair --key-name "$KEY_NAME" --public-key-material "$PUB_KEY" >/dev/null
  chmod 400 "$SSH_KEY_PATH"
  echo "✓  Imported $KEY_NAME into AWS"
elif [ "$AWS_HAS_KEY" -eq 0 ]; then
  [ -f "$SSH_KEY_PATH" ] && rm -f "$SSH_KEY_PATH"
  aws ec2 create-key-pair --key-name "$KEY_NAME" --query KeyMaterial --output text > "$SSH_KEY_PATH"
  chmod 400 "$SSH_KEY_PATH"
  echo "✓  Created key pair and wrote $SSH_KEY_PATH"
else
  chmod 400 "$SSH_KEY_PATH" 2>/dev/null || true
  echo "✓  Using $SSH_KEY_PATH"
fi

# ── Security group (SSH from this IP only) ────────────────────────────────────
log "Security group: $SG_NAME"
MY_IP="$(curl -sf --max-time 5 https://checkip.amazonaws.com || curl -sf --max-time 5 https://ifconfig.me || echo '')"
if [ -z "$MY_IP" ]; then
  echo "⚠  Could not detect your public IP — using 0.0.0.0/0 for SSH (less secure). Set MY_IP=... to override."
  SSH_CIDR="0.0.0.0/0"
else
  SSH_CIDR="${MY_IP}/32"
  echo "→ SSH allowed from $SSH_CIDR"
fi

VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
SG_ID="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID="$(aws ec2 create-security-group --group-name "$SG_NAME" --description "AK System EC2" --vpc-id "$VPC_ID" --query GroupId --output text)"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22 --cidr "$SSH_CIDR" >/dev/null
  echo "✓  Created $SG_ID"
else
  echo "✓  Using existing $SG_ID"
fi

# ── Ubuntu 22.04 AMI ──────────────────────────────────────────────────────────
log "Ubuntu 22.04 AMI"
AMI_ID="$(aws ec2 describe-images \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)"
echo "→ $AMI_ID"

# ── Launch instance (skip if one already running with our tag) ────────────────
log "EC2 instance"
EXISTING="$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$TAG_NAME" "Name=instance-state-name,Values=running,pending,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)"
if [ -n "$EXISTING" ] && [ "$EXISTING" != "None" ]; then
  INSTANCE_ID="$EXISTING"
  echo "✓  Reusing instance $INSTANCE_ID"
  STATE="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].State.Name' --output text)"
  if [ "$STATE" = "stopped" ]; then
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  fi
else
  INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$TAG_NAME}]" \
    --query Instances[0].InstanceId --output text)"
  echo "→ Launched $INSTANCE_ID (waiting for running...)"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
fi

# ── Elastic IP ────────────────────────────────────────────────────────────────
log "Elastic IP"
EIP_ALLOC="$(aws ec2 describe-addresses --filters "Name=instance-id,Values=$INSTANCE_ID" --query 'Addresses[0].AllocationId' --output text 2>/dev/null || true)"
if [ -z "$EIP_ALLOC" ] || [ "$EIP_ALLOC" = "None" ]; then
  EIP_ALLOC="$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)"
  aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$EIP_ALLOC" >/dev/null
fi
PUBLIC_IP="$(aws ec2 describe-addresses --allocation-ids "$EIP_ALLOC" --query 'Addresses[0].PublicIp' --output text)"
echo "✓  Elastic IP: $PUBLIC_IP"

# ── Wait for SSH ──────────────────────────────────────────────────────────────
log "Waiting for SSH"
for i in $(seq 1 30); do
  if ssh -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    -i "$SSH_KEY_PATH" "ubuntu@${PUBLIC_IP}" 'echo ok' 2>/dev/null; then
    echo "✓  SSH ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "✗  SSH not ready after 5 min. Try manually: ssh -i $SSH_KEY_PATH ubuntu@$PUBLIC_IP"
    exit 1
  fi
  sleep 10
done

# ── Write deploy/ec2.env ──────────────────────────────────────────────────────
cat > "$EC2_ENV" <<EOF
# Auto-generated by scripts/aws-provision-ec2.sh
DEPLOY_HOST=${PUBLIC_IP}
DEPLOY_USER=ubuntu
DEPLOY_PATH=/opt/ak-system
SSH_KEY=${SSH_KEY_PATH}
APP_URL=
EOF
echo "✓  Wrote $EC2_ENV"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓  EC2 ready: ubuntu@${PUBLIC_IP}"
echo "   SSH:  ssh -i ${SSH_KEY_PATH} ubuntu@${PUBLIC_IP}"
echo "   Next: bash scripts/ec2-up.sh"
echo "════════════════════════════════════════════════════════════"
