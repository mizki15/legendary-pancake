"""Validation shared by both journal storage backends."""

import io
import warnings
from datetime import date, datetime
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from PIL import Image, ImageOps, UnidentifiedImageError

SEASONS = ("spring", "summer", "autumn", "winter")
MAX_PHOTO_BYTES = 350_000


class Invalid(ValueError):
    pass


def today():
    return datetime.now(ZoneInfo("Asia/Tokyo")).date()


def text_value(value, name, limit, required=False):
    if not isinstance(value, str):
        raise Invalid(f"{name}は文字で入力してください。")
    value = value.strip()
    if required and not value:
        raise Invalid(f"{name}を入力してください。")
    if len(value) > limit:
        raise Invalid(f"{name}は{limit}文字以内で入力してください。")
    return value


def validate_idea(data, previous=None):
    if not isinstance(data, dict):
        raise Invalid("入力内容を確認してください。")
    result = dict(previous or {})
    allowed = {"title", "note", "place", "reference_url", "budget", "seasons", "favorite", "completed_on", "memory"}
    if set(data) - allowed:
        raise Invalid("保存できない項目が含まれています。")
    for key, name, limit in (("title", "タイトル", 120), ("note", "メモ", 3000), ("place", "場所", 300), ("reference_url", "参考URL", 2000), ("memory", "感想", 3000)):
        result[key] = text_value(data.get(key, result.get(key, "")), name, limit, key == "title")
    url = result["reference_url"]
    if url:
        try:
            parsed = urlsplit(url)
            if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password or any(ord(c) < 33 for c in url):
                raise ValueError
        except ValueError:
            raise Invalid("参考URLは https:// または http:// から始まるURLを入力してください。") from None
    budget = data.get("budget", result.get("budget"))
    if budget is not None and (type(budget) is not int or not 0 <= budget <= 100_000_000):
        raise Invalid("予算は0〜100,000,000円の整数で入力してください。")
    result["budget"] = budget
    seasons = data.get("seasons", result.get("seasons", []))
    if not isinstance(seasons, list) or any(s not in SEASONS for s in seasons) or len(seasons) > 4:
        raise Invalid("季節は春・夏・秋・冬から選んでください。")
    result["seasons"] = [s for s in SEASONS if s in seasons]
    favorite = data.get("favorite", result.get("favorite", False))
    if type(favorite) is not bool:
        raise Invalid("お気に入りの指定を確認してください。")
    result["favorite"] = favorite
    completed = data.get("completed_on", result.get("completed_on"))
    if completed is not None:
        try:
            if not isinstance(completed, str) or date.fromisoformat(completed).isoformat() != completed:
                raise ValueError
            if date.fromisoformat(completed) > today():
                raise ValueError
        except (TypeError, ValueError):
            raise Invalid("実施日は今日以前の日付で入力してください。") from None
    result["completed_on"] = completed
    return result


def compress_photo(upload):
    raw = upload.read(12_000_001)
    if len(raw) > 12_000_000:
        raise Invalid("写真は12MB以内で選んでください。")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in ("JPEG", "PNG", "WEBP"):
                    raise Invalid("JPEG・PNG・WebPの写真を選んでください。")
                if source.width * source.height > 20_000_000:
                    raise Invalid("写真が大きすぎます。小さくしてから選んでください。")
                source.draft("RGB", (1400, 1400))
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((1400, 1400))
                for quality in (80, 65, 50):
                    out = io.BytesIO()
                    image.save(out, format="WEBP", quality=quality, method=4)
                    if out.tell() <= MAX_PHOTO_BYTES:
                        return out.getvalue()
                image.thumbnail((900, 900))
                out = io.BytesIO()
                image.save(out, format="WEBP", quality=45, method=4)
                if out.tell() <= MAX_PHOTO_BYTES:
                    return out.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise Invalid("写真を読み込めません。JPEG・PNG・WebPで選び直してください。") from None
    raise Invalid("写真を小さくしてから、もう一度選んでください。")
