#!/usr/bin/env python
"""把单文件游戏里内嵌的 base64 图片换成 WebP。

支持三种内嵌写法：
  1. CSS   : .foo{background:url("data:image/png;base64,....")}      -> 抽成 art/bg-NN.webp
  2. 拼接   : key:"chunk" +  "chunk" + ...  或  key:"chunk" +"chunk"...
  3. 数组   : key:[ "chunk", "chunk", ... ].join("")

用法:
  python scripts/slim-games.py analyze <file> [<file>...]
  python scripts/slim-games.py apply   <file> [<file>...]
环境变量: FFMPEG, QUALITY(默认 80)
"""
import base64
import os
import re
import subprocess
import sys
import tempfile

FFMPEG = os.environ.get("FFMPEG", "D:/WorkBuddy Space/tools/ffmpeg/ffmpeg.exe")
QUALITY = os.environ.get("QUALITY", "80")
CHUNK = 2000

CSS_RE = re.compile(r'url\("data:image/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)"\)')
BLOB_START_RE = re.compile(r'^(\s*)(.*?)"([A-Za-z0-9+/=]{200,})"(.*)$')
CONT_RE = re.compile(r'^\s*\+?\s*"([A-Za-z0-9+/=]+)"(.*)$')
ARR_START_RE = re.compile(r'^(\s*)(.*?)\[\s*$')
ARR_CLOSE_RE = re.compile(r'^(\s*)\](.*)$')
ARR_ITEM_RE = re.compile(r'^\s*"([A-Za-z0-9+/=]+)"\s*,?\s*$')


def magic(raw):
    if raw[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if raw[:3] == b'\xff\xd8\xff':
        return 'jpeg'
    if raw[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return 'webp'
    return None


def is_complete(raw, kind):
    if kind == 'png':
        return raw.rstrip(b'\x00').endswith(b'IEND\xaeB`\x82')
    if kind == 'jpeg':
        return raw.rstrip(b'\x00').endswith(b'\xff\xd9')
    if kind == 'gif':
        return raw.endswith(b';')
    return True


def to_webp(raw, tmpdir, tag, animated=False):
    src = os.path.join(tmpdir, tag + '.src')
    dst = os.path.join(tmpdir, tag + '.webp')
    with open(src, 'wb') as f:
        f.write(raw)
    cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
           '-c:v', 'libwebp', '-quality', QUALITY]
    if animated:
        cmd += ['-loop', '0']
    cmd.append(dst)
    subprocess.run(cmd, capture_output=True)
    if not os.path.exists(dst):
        return None
    with open(dst, 'rb') as f:
        out = f.read()
    return out or None


def collect_runs(lines):
    runs = []
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]

        m = CSS_RE.search(line)
        if m:
            runs.append(dict(start=i, end=i + 1, kind='css', payload=m.group(2),
                             indent='', head=line[:m.start()], tail=line[m.end():], close=''))
            i += 1
            continue

        m = ARR_START_RE.match(line)
        if m and line.rstrip().endswith('['):
            j = i + 1
            payloads = []
            closed = False
            while j < n and j - i < 4000:
                mc = ARR_CLOSE_RE.match(lines[j])
                if mc:
                    runs.append(dict(start=i, end=j + 1, kind='array',
                                     payload=''.join(payloads), indent=m.group(1),
                                     head=m.group(2), tail='', close=mc.group(2)))
                    i = j + 1
                    closed = True
                    break
                mi = ARR_ITEM_RE.match(lines[j])
                if mi:
                    payloads.append(mi.group(1))
                elif lines[j].strip():
                    break
                j += 1
            if closed:
                continue
            i += 1
            continue

        m = BLOB_START_RE.match(line)
        if m:
            indent, head, payload, tail = m.groups()
            j = i
            parts = [payload]
            while j + 1 < n:
                nxt = lines[j + 1]
                m2 = CONT_RE.match(nxt)
                if not m2:
                    break
                if not (nxt.lstrip().startswith('+') or tail.rstrip().endswith('+')):
                    break
                parts.append(m2.group(1))
                tail = m2.group(2)
                j += 1
            runs.append(dict(start=i, end=j + 1, kind='blob', payload=''.join(parts),
                             indent=indent, head=head, tail=tail, close=''))
            i = j + 1
            continue

        i += 1
    return runs


def wrap_blob(payload, indent, head, tail):
    chunks = [payload[k:k + CHUNK] for k in range(0, len(payload), CHUNK)]
    if len(chunks) == 1:
        return [f'{indent}{head}"{chunks[0]}"{tail}']
    out = [f'{indent}{head}"{chunks[0]}" +']
    for c in chunks[1:-1]:
        out.append(f'{indent}  "{c}" +')
    out.append(f'{indent}  "{chunks[-1]}"{tail}')
    return out


def wrap_array(payload, indent, head, close):
    chunks = [payload[k:k + CHUNK] for k in range(0, len(payload), CHUNK)]
    out = [f'{indent}{head}[']
    for c in chunks:
        out.append(f'{indent}  "{c}",')
    out.append(f'{indent}]{close}')
    return out


INLINE_RE = re.compile(r'"data:image/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]{2000,})"')


def process_inline(path, text, raw_text, apply_changes):
    """整站被压成一行的单文件游戏：直接在文本层面替换每个超长 base64 串。"""
    tmpdir = tempfile.mkdtemp(prefix='slim-')
    st = dict(runs=0, img=0, css=0, arr=0, skip=0, fail=0, before=0, after=0, files=0)
    seq = [0]

    def repl(mo):
        st['runs'] += 1
        payload = mo.group(1)
        try:
            data = base64.b64decode(payload)
        except Exception:
            st['skip'] += 1
            return mo.group(0)
        kind = magic(data)
        if kind is None or not is_complete(data, kind):
            st['skip'] += 1
            return mo.group(0)
        seq[0] += 1
        webp = to_webp(data, tmpdir, f'a{seq[0]}', animated=(kind == 'gif'))
        if webp is None:
            st['fail'] += 1
            return mo.group(0)
        st['before'] += len(data)
        st['after'] += len(webp)
        st['img'] += 1
        return '"data:image/webp;base64,' + base64.b64encode(webp).decode('ascii') + '"'

    out = INLINE_RE.sub(repl, text)
    print(f'{path}')
    print(f'  单行内嵌模式：命中 {st["runs"]} 段，转换 {st["img"]} 张 | 跳过 {st["skip"]} | 失败 {st["fail"]}')
    print(f'  图片 {st["before"]/1048576:.2f}MB -> WebP {st["after"]/1048576:.2f}MB'
          f' (省 {(1 - st["after"]/max(st["before"], 1))*100:.0f}%)')
    if st['fail']:
        print('  !! 有图片转换失败，已中止写入')
        return st
    if st['img']:
        for old in ('data:image/png;base64,', 'data:image/jpeg;base64,'):
            out = out.replace(old, 'data:image/webp;base64,')
    if apply_changes:
        with open(path, 'wb') as f:
            f.write(out.encode('utf-8', 'surrogateescape'))
        print(f'  写入 {os.path.getsize(path)/1048576:.2f} MB (原 {len(raw_text)/1048576:.2f} MB)')
    else:
        print(f'  预估 {len(out.encode("utf-8", "surrogateescape"))/1048576:.2f} MB')
    return st


def process(path, apply_changes):
    raw_text = open(path, 'rb').read()
    text = raw_text.decode('utf-8', 'surrogateescape')
    _lines = text.split('\n')
    if len(_lines) < 200 and max(len(l) for l in _lines) > 100000:
        return process_inline(path, text, raw_text, apply_changes)
    lines = text.split('\n')
    runs = collect_runs(lines)
    base_dir = os.path.dirname(path)
    art_dir = os.path.join(base_dir, 'art')
    st = dict(runs=0, img=0, css=0, arr=0, skip=0, fail=0,
              before=0, after=0, files=0)
    tmpdir = tempfile.mkdtemp(prefix='slim-')
    out_lines, cursor, seq = [], 0, 0

    for r in runs:
        st['runs'] += 1
        try:
            data = base64.b64decode(r['payload'])
        except Exception:
            st['skip'] += 1
            continue
        kind = magic(data)
        if kind is None:
            st['skip'] += 1
            continue
        if not is_complete(data, kind):
            st['fail'] += 1
            continue
        seq += 1
        webp = to_webp(data, tmpdir, f'a{seq}', animated=(kind == 'gif'))
        if webp is None:
            st['fail'] += 1
            continue
        st['before'] += len(data)
        st['after'] += len(webp)
        out_lines.extend(lines[cursor:r['start']])
        if r['kind'] == 'css':
            name = f'art/bg-{seq:02d}.webp'
            if apply_changes:
                os.makedirs(art_dir, exist_ok=True)
                with open(os.path.join(base_dir, name), 'wb') as f:
                    f.write(webp)
                st['files'] += 1
            out_lines.append(f"{r['head']}url(\"{name}\"){r['tail']}")
            st['css'] += 1
        else:
            b64 = base64.b64encode(webp).decode('ascii')
            if r['kind'] == 'array':
                out_lines.extend(wrap_array(b64, r['indent'], r['head'], r['close']))
                st['arr'] += 1
            else:
                out_lines.extend(wrap_blob(b64, r['indent'], r['head'], r['tail']))
                st['img'] += 1
        cursor = r['end']

    out_lines.extend(lines[cursor:])
    out = '\n'.join(out_lines)

    print(f'{path}')
    print(f'  段 {st["runs"]}: CSS {st["css"]} / 拼接 {st["img"]} / 数组 {st["arr"]}'
          f' | 跳过 {st["skip"]} | 失败 {st["fail"]}')
    print(f'  图片 {st["before"]/1048576:.2f}MB -> WebP {st["after"]/1048576:.2f}MB'
          f' (省 {(1 - st["after"]/max(st["before"], 1))*100:.0f}%)')
    if st['fail']:
        print('  !! 有图片转换失败，已中止写入')
        return st

    if st['img'] or st['arr']:
        for old in ('data:image/png;base64,', 'data:image/jpeg;base64,'):
            out = out.replace(old, 'data:image/webp;base64,')

    if apply_changes:
        with open(path, 'wb') as f:
            f.write(out.encode('utf-8', 'surrogateescape'))
        print(f'  写入 {os.path.getsize(path)/1048576:.2f} MB (原 {len(raw_text)/1048576:.2f} MB)')
    else:
        print(f'  预估 {len(out.encode("utf-8", "surrogateescape"))/1048576:.2f} MB')
    return st


if __name__ == '__main__':
    mode = sys.argv[1]
    for f in sys.argv[2:]:
        process(f, mode == 'apply')
