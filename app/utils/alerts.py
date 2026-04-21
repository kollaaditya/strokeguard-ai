"""
AWS SNS alert sender for HIGH risk notifications.
"""

import os
import boto3
from botocore.exceptions import ClientError


def send_alert(user_email: str, risk_probability: float, username: str):
    """Send SMS/email alert via AWS SNS when risk is HIGH."""
    topic_arn = os.getenv("SNS_TOPIC_ARN")
    region = os.getenv("AWS_REGION", "us-east-1")

    if not topic_arn or topic_arn.startswith("arn:aws:sns:us-east-1:<account"):
        print("[ALERT] SNS not configured — skipping alert.")
        return False

    try:
        client = boto3.client("sns", region_name=region)
        message = (
            f"🚨 STROKE RISK ALERT 🚨\n\n"
            f"User: {username}\n"
            f"Risk Probability: {risk_probability:.1f}%\n"
            f"Status: HIGH RISK\n\n"
            f"Please seek immediate medical attention.\n"
            f"Emergency: 108"
        )
        client.publish(
            TopicArn=topic_arn,
            Message=message,
            Subject="⚠️ High Stroke Risk Alert",
        )
        print(f"[ALERT] SNS alert sent for user {username}")
        return True
    except ClientError as e:
        print(f"[ALERT ERROR] {e.response['Error']['Message']}")
        return False
