#!/usr/bin/env python3
"""Заливка собранного вьюера (dist/) в Yandex Object Storage бакет playcanvasviewer.

S3-совместимо (endpoint storage.yandexcloud.net). Конфиг из ENV:
  YC_S3_KEY_ID, YC_S3_SECRET, VIEWER_BUCKET (default playcanvasviewer)
Запускать ПОСЛЕ сборки (npm run build). index.html/index.js/style.css отдаются
с Cache-Control:no-cache, чтобы обновления вьюера подхватывались сразу. Текстовые файлы
заливаются предсжатыми (см. COMPRESSIBLE): хранилище само не жмёт.
"""
import gzip, hashlib, io, os, mimetypes, boto3
from botocore.client import Config
from datetime import datetime, timezone

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

# Порог, выше которого boto3 грузит объект частями. Файлы до него читаем целиком ради
# контрольной суммы, выше — сверяем только размер.
MULTIPART_THRESHOLD = 8 * 1024 * 1024

# Каталог того, что уже лежит в бакете: размер и ETag. Одним листингом на тысячу объектов,
# а не запросом на файл — объектов тут тысячи.
#
# Зачем вообще. Скрипт заливал весь `dist` целиком, а это 7.7 ГБ, из которых 7.5 ГБ — модели.
# Правка вьюера весит два с половиной мегабайта, но деплой всё равно перекладывал гигабайты и
# занимал до получаса. Теперь неизменившееся пропускается.
remote = {}
paginator = s3.get_paginator("list_objects_v2")
for page in paginator.paginate(Bucket=BUCKET):
    for obj in page.get("Contents", []):
        remote[obj["Key"]] = (obj["Size"], obj["ETag"].strip('"'))

# Собранный многочастной загрузкой объект имеет ETag вида "<md5>-<число частей>", и повторить
# его локально нельзя, не зная разбиения. Для таких сравниваем только размер: модели меняются
# редко, а совпасть по размеру после правки почти невозможно. `FORCE_UPLOAD=1` заливает всё.
FORCE = os.environ.get("FORCE_UPLOAD") == "1"

def unchanged(key, payload, size):
    if FORCE or key not in remote:
        return False
    remote_size, etag = remote[key]
    if remote_size != size:
        return False
    if "-" in etag:
        return True
    digest = hashlib.md5(payload).hexdigest() if payload is not None else None
    if digest is None:
        return False
    return digest == etag

count = 0
skipped = 0
raw_total = 0
sent_total = 0
skipped_total = 0
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

        # Считаем контрольную сумму только для того, что и так прочитано или невелико: читать
        # ради сверки семь гигабайт моделей значило бы поменять сеть на диск.
        if packed is not None:
            payload, sent_size = packed, len(packed)
        elif size <= MULTIPART_THRESHOLD:
            with open(lp, "rb") as fh:
                payload = fh.read()
            sent_size = size
        else:
            payload, sent_size = None, size

        if unchanged(key, payload, sent_size):
            skipped += 1
            skipped_total += sent_size
            continue

        if packed is None:
            s3.upload_file(lp, BUCKET, key, ExtraArgs=extra)
        else:
            s3.upload_fileobj(io.BytesIO(packed), BUCKET, key, ExtraArgs=extra)

        raw_total += size
        sent_total += sent_size
        count += 1

# Обрывки прерванных многочастных загрузок сами не исчезают и занимают место в бакете. Наши
# деплои идут по одному (в workflow серийная очередь), поэтому всё незавершённое — мусор от
# отменённых запусков. Час выдержки на случай, если рядом всё же кто-то грузит.
aborted = 0
try:
    now = datetime.now(timezone.utc)
    uploads = s3.list_multipart_uploads(Bucket=BUCKET).get("Uploads", [])
    for up in uploads:
        if (now - up["Initiated"]).total_seconds() < 3600:
            continue
        s3.abort_multipart_upload(Bucket=BUCKET, Key=up["Key"], UploadId=up["UploadId"])
        aborted += 1
except Exception as err:  # уборка не должна ронять деплой
    print(f"Не удалось убрать обрывки загрузок: {err}")

saved = raw_total - sent_total
print(f"Залито {count} файлов в s3://{BUCKET}/, пропущено без изменений {skipped} "
      f"({skipped_total / 1048576:.1f} МБ)")
print(f"Объём: {raw_total / 1048576:.1f} МБ на диске → {sent_total / 1048576:.1f} МБ в хранилище "
      f"(сжатие сэкономило {saved / 1048576:.1f} МБ)")
if aborted:
    print(f"Убрано обрывков прерванных загрузок: {aborted}")
print("URL: https://playcanvasviewer.website.yandexcloud.net/")
