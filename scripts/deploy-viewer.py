#!/usr/bin/env python3
"""Заливка собранного вьюера (dist/) в Yandex Object Storage бакет playcanvasviewer.

S3-совместимо (endpoint storage.yandexcloud.net). Конфиг из ENV:
  YC_S3_KEY_ID, YC_S3_SECRET, VIEWER_BUCKET (default playcanvasviewer)
Запускать ПОСЛЕ сборки (npm run build). index.html/index.js/style.css отдаются
с Cache-Control:no-cache, чтобы обновления вьюера подхватывались сразу. Текстовые файлы
заливаются предсжатыми (см. COMPRESSIBLE): хранилище само не жмёт.
"""
import gzip, io, os, mimetypes, boto3
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

# Object Storage отдаёт объект ровно таким, каким он залит: сжимать на лету оно не умеет,
# заголовка Content-Encoding в ответах не было вовсе. Поэтому текстовые файлы кладём уже
# сжатыми и помечаем `ContentEncoding: gzip` — распакует браузер. На бандле это 2.43 МБ → 0.63.
#
# Бинарные форматы сюда не входят намеренно: .glb, .hdr, .wasm, картинки и шрифты уже сжаты,
# выигрыш околонулевой, а .glb вдобавок качается диапазонами (Range) — там Content-Encoding
# только мешает. Мелочь меньше килобайта не трогаем: накладные расходы съедят выигрыш.
COMPRESSIBLE = {".js", ".css", ".html", ".json", ".svg", ".map", ".txt", ".xml"}
MIN_COMPRESS_BYTES = 1024
MIN_COMPRESS_GAIN = 0.9  # если не выиграли даже десятой части — заливаем как есть

count = 0
raw_total = 0
sent_total = 0
for dp, _, files in os.walk(DIST):
    for f in files:
        if f == ".DS_Store":
            continue
        lp = os.path.join(dp, f)
        key = os.path.relpath(lp, DIST).replace(os.sep, "/")
        ct = mimetypes.guess_type(lp)[0] or "application/octet-stream"
        extra = {"ContentType": ct}
        extra["CacheControl"] = "no-cache" if f in NO_CACHE else "public, max-age=86400"

        size = os.path.getsize(lp)
        packed = None
        if os.path.splitext(f)[1].lower() in COMPRESSIBLE and size >= MIN_COMPRESS_BYTES:
            with open(lp, "rb") as fh:
                candidate = gzip.compress(fh.read(), 9, mtime=0)
            if len(candidate) < size * MIN_COMPRESS_GAIN:
                extra["ContentEncoding"] = "gzip"
                packed = candidate

        if packed is None:
            s3.upload_file(lp, BUCKET, key, ExtraArgs=extra)
        else:
            s3.upload_fileobj(io.BytesIO(packed), BUCKET, key, ExtraArgs=extra)

        raw_total += size
        sent_total += size if packed is None else len(packed)
        count += 1

saved = raw_total - sent_total
print(f"Залито {count} файлов в s3://{BUCKET}/")
print(f"Объём: {raw_total / 1048576:.1f} МБ на диске → {sent_total / 1048576:.1f} МБ в хранилище "
      f"(сжатие сэкономило {saved / 1048576:.1f} МБ)")
print("URL: https://playcanvasviewer.website.yandexcloud.net/")
