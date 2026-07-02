#!/usr/bin/env bash
# Ensure the current public IP can SSH to the EC2 instance (security group).
# Called automatically from deploy-ec2.sh before rsync.
set -euo pipefail

SG_NAME="${SG_NAME:-ak-system-web}"
MY_IP="${MY_IP:-$(curl -sf --max-time 10 https://checkip.amazonaws.com || curl -sf --max-time 10 https://ifconfig.me || true)}"

if [ -z "$MY_IP" ]; then
  echo "⚠  Could not detect public IP — skipping SSH security-group update"
  exit 0
fi

SG_ID="$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"

if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  echo "⚠  Security group $SG_NAME not found — skipping"
  exit 0
fi

CIDR="${MY_IP}/32"
if aws ec2 describe-security-groups --group-ids "$SG_ID" \
  --query "SecurityGroups[0].IpPermissions[?FromPort==\`22\`].IpRanges[].CidrIp" \
  --output text 2>/dev/null | grep -qF "$CIDR"; then
  echo "✓  SSH already allowed from $CIDR"
  exit 0
fi

if aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22 --cidr "$CIDR" >/dev/null 2>&1; then
  echo "✓  SSH opened for $CIDR on $SG_ID"
else
  echo "⚠  Could not add SSH rule for $CIDR (may already exist)"
fi
