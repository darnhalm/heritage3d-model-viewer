#!/usr/bin/env python3
"""Заливка собранного вьюера (dist/) в Yandex Object Storage бакет playcanvasviewer.

S3-совместимо (endpoint storage.yandexcloud.net). Конфиг из ENV:
  YC_S3_KEY_ID, YC_S3_SECRET, VIEWER_BUCKET (default playcanvasviewer)
Запускать ПОСЛЕ сборки (npm run build). index.html/index.js/style.css отдаются
с Cache-Control:no-cache, чтобы обновления вьюера подхватывались сразу.
"""
import os, mimetypes, boto3
from botocore.client import Config

BUCKET = os.environ.get("VIEWER_BUCKET", "playcanvasviewer")
DIST = "dist"

if not os.path.isdir(DIST):
    raise SystemExit("dist/ не найден — сначала npm run build")

s3 = boto3.client(
    "s3", endpoint_url="https://storage.yandexcloud.net",
    aws_access_key_id=os.environ["YC_S3_KEY_ID"],
    aws_secret_access_key=os.environ["YC_S3_SECRET"],
    region_name="ru-central1", config=Config(signature_version="s3v4"),
)
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")

# Файлы вьюера без хэша в имени → не кэшировать, чтобы правки были видны сразу.
NO_CACHE = {"index.html", "index.js", "style.css", "fonts.css", "manifest.json"}

count = 0
for dp, _, files in os.walk(DIST):
    for f in files:
        if f == ".DS_Store":
            continue
        lp = os.path.join(dp, f)
        key = os.path.relpath(lp, DIST).replace(os.sep, "/")
        ct = mimetypes.guess_type(lp)[0] or "application/octet-stream"
        extra = {"ContentType": ct}
        extra["CacheControl"] = "no-cache" if f in NO_CACHE else "public, max-age=86400"
        s3.upload_file(lp, BUCKET, key, ExtraArgs=extra)
        count += 1

print(f"Залито {count} файлов в s3://{BUCKET}/")
print("URL: https://playcanvasviewer.website.yandexcloud.net/")
