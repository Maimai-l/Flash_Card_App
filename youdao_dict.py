from __future__ import annotations

import hashlib
import json
import os
import time
import traceback
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

import requests


# ---------------------------
# Config
# ---------------------------

@dataclass(frozen=True)
class YoudaoConfig:
    cache_dir: str = "./youdao_cache"
    use_cache: bool = True
    timeout: int = 10
    sleep_seconds: float = 0.25   # 控制频率，个人学习建议 0.2~0.5
    retries: int = 1              # 失败重试次数（不含首次），建议 1~2
    backoff_seconds: float = 0.8  # 重试退避时间


# ---------------------------
# Sign (same logic as your script)
# ---------------------------

def _md5(s: str) -> str:
    h = hashlib.md5()
    h.update(s.encode("utf-8"))
    return h.hexdigest()


def cal_youdao_web_sign(word: str) -> Tuple[str, int]:
    """
    Returns: (sign, t)
    """
    w = word
    v = "webdict"
    o = _md5(w + v)
    t = len(w + v) % 10
    n = "web" + w + str(t) + "Mk6hqtUp33DGGtoS63tTJbMUYjRrG1Lu" + o
    sign = _md5(n)
    return sign, t


# ---------------------------
# Helpers
# ---------------------------

def _normalize_word(word: str) -> str:
    # 缓存键归一化：避免 Run/run 生成两份缓存
    return (word or "").strip().lower()


def _safe_get(d: Dict[str, Any], path: str, default=None):
    cur: Any = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _cache_path(cache_dir: str, word_norm: str) -> str:
    # 简单处理：文件名直接用归一化后的词
    return os.path.join(cache_dir, f"{word_norm}.json")


def _extract_result(word_norm: str, data: Dict[str, Any]) -> Dict[str, Any]:
    # phones
    us_phone = _safe_get(data, "ec.word.usphone", "") or ""
    uk_phone = _safe_get(data, "ec.word.ukphone", "") or ""

    # exam types
    exam_type = _safe_get(data, "ec.exam_type", []) or []
    if not isinstance(exam_type, list):
        exam_type = []

    # translations
    trs = _safe_get(data, "ec.word.trs", []) or []
    translations: List[str] = []
    if isinstance(trs, list):
        for tr in trs:
            if not isinstance(tr, dict):
                continue
            pos = tr.get("pos", "") or ""
            tran = tr.get("tran", "") or ""
            if tran:
                translations.append(f"{pos}{tran}")

    # phrases
    phrs_list: List[Dict[str, str]] = []
    phrs = _safe_get(data, "phrs.phrs", []) or []
    if isinstance(phrs, list):
        for phr in phrs:
            if not isinstance(phr, dict):
                continue
            hw = phr.get("headword", "") or ""
            trans = phr.get("translation", "") or ""
            if hw or trans:
                phrs_list.append({"headword": hw, "translation": trans})

    # web_trans fallback if no phrs
    if not phrs_list:
        web_trans = _safe_get(data, "web_trans.web-translation", []) or []
        if isinstance(web_trans, list):
            for item in web_trans:
                if not isinstance(item, dict):
                    continue
                key = item.get("key", "") or ""
                key_speech = item.get("key-speech", "") or ""
                trans_arr = item.get("trans", []) or []
                values: List[str] = []
                if isinstance(trans_arr, list):
                    for t in trans_arr:
                        if isinstance(t, dict) and t.get("value"):
                            values.append(t["value"])
                trans_join = ", ".join(values)
                if key or trans_join:
                    out: Dict[str, str] = {"headword": key, "translation": trans_join}
                    if key_speech:
                        out["key-speech"] = key_speech
                    phrs_list.append(out)

    # sentences
    sentences_list: List[Dict[str, str]] = []
    sps = _safe_get(data, "blng_sents_part.sentence-pair", []) or []
    if isinstance(sps, list):
        for sp in sps:
            if not isinstance(sp, dict):
                continue
            sent = sp.get("sentence", "") or ""
            trans = sp.get("sentence-translation", "") or ""
            if sent or trans:
                sentences_list.append({"sentence": sent, "translation": trans})

    # 固化 schema：字段永远存在（消费端更稳）
    return {
        "word": word_norm,
        "usPhone": us_phone,
        "ukPhone": uk_phone,
        "examType": exam_type,
        "translations": translations,
        "phrs": phrs_list,
        "sentences": sentences_list,
        # 如需调试可打开：
        # "raw": data,
    }


# ---------------------------
# Public API
# ---------------------------

def lookup(
    word: str,
    config: Optional[YoudaoConfig] = None,
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Query one word. Returns a dict (schema fixed) or None on failure.

    - word: raw input word
    - config: YoudaoConfig, optional
    - session: optional requests.Session for reuse in batch calls
    """
    cfg = config or YoudaoConfig()
    w = _normalize_word(word)
    if not w:
        return None

    _ensure_dir(cfg.cache_dir)
    cache_file = _cache_path(cfg.cache_dir, w)

    # Cache hit
    if cfg.use_cache and os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            # cache corrupted -> fall through to online fetch
            pass

    sign, t = cal_youdao_web_sign(w)
    url = (
        "https://dict.youdao.com/jsonapi_s"
        f"?doctype=json&jsonversion=4&le=en&t={t}&client=web"
        f"&sign={sign}&keyfrom=webdict&q={w}"
    )

    sess = session or requests.Session()

    def _fetch_once() -> Dict[str, Any]:
        resp = sess.get(url, timeout=cfg.timeout)
        resp.raise_for_status()
        data = resp.json()
        return _extract_result(w, data)

    # Attempt + retries
    last_err: Optional[Exception] = None
    attempts = 1 + max(0, cfg.retries)

    for i in range(attempts):
        try:
            result = _fetch_once()

            if cfg.use_cache:
                try:
                    with open(cache_file, "w", encoding="utf-8") as f:
                        json.dump(result, f, ensure_ascii=False, indent=2)
                except Exception:
                    # cache write failure shouldn't break lookup
                    pass

            if cfg.sleep_seconds and cfg.sleep_seconds > 0:
                time.sleep(cfg.sleep_seconds)

            return result

        except Exception as e:
            last_err = e
            # 退避后重试（最后一次不睡）
            if i < attempts - 1:
                time.sleep(cfg.backoff_seconds * (2 ** i))
            else:
                # 最终失败：返回 None
                # 如你希望抛异常，可把 None 改为 raise
                # traceback.print_exc()
                return None

    # unreachable
    return None


def lookup_many(
    words: Union[Iterable[str], List[str]],
    config: Optional[YoudaoConfig] = None,
    *,
    dedupe: bool = True,
    keep_order: bool = True,
) -> List[Optional[Dict[str, Any]]]:
    """
    Batch lookup.
    - words: iterable of words
    - dedupe: True -> 去重以减少请求（默认）
    - keep_order: True -> 输出与输入同长度同顺序；否则返回去重后的结果列表
    """
    cfg = config or YoudaoConfig()

    # Normalize inputs
    raw_list = list(words)
    norm_list = [_normalize_word(w) for w in raw_list]

    # Option A: keep order (default) — most convenient for "词表"调用
    if keep_order:
        out: List[Optional[Dict[str, Any]]] = [None] * len(norm_list)

        # Dedupe mapping
        if dedupe:
            idx_map: Dict[str, List[int]] = {}
            for idx, w in enumerate(norm_list):
                if not w:
                    out[idx] = None
                    continue
                idx_map.setdefault(w, []).append(idx)

            uniq_words = list(idx_map.keys())
            with requests.Session() as sess:
                for uw in uniq_words:
                    r = lookup(uw, config=cfg, session=sess)
                    for idx in idx_map[uw]:
                        out[idx] = r
            return out

        # No dedupe: straightforward
        with requests.Session() as sess:
            for i, w in enumerate(norm_list):
                out[i] = lookup(w, config=cfg, session=sess) if w else None
        return out

    # Option B: not keep order (returns unique results only if dedupe)
    if dedupe:
        uniq = []
        seen = set()
        for w in norm_list:
            if w and w not in seen:
                seen.add(w)
                uniq.append(w)
        with requests.Session() as sess:
            return [lookup(w, config=cfg, session=sess) for w in uniq]

    with requests.Session() as sess:
        return [lookup(w, config=cfg, session=sess) if w else None for w in norm_list]