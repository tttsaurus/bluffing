#!/usr/bin/env python3
"""Refresh Commons audio provenance for the reviewed 2,000-word selection.
No bulk audio download: the game caches recordings on disk as they are requested.
Resume-safe; uses curl and the Python standard library only.
"""
import hashlib, html, json, re, subprocess, time, urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
RES=ROOT/'server/resources/spelling'
selection=json.loads((ROOT/'scripts/vocabulary/selection.json').read_text())
cache=ROOT/'.local/spelling-metadata';cache.mkdir(parents=True,exist_ok=True)
records={}
author_overrides=json.loads((ROOT/'scripts/vocabulary/author-overrides.json').read_text())
page_cache={}
for cached in cache.glob('*.json'):
 for page in json.loads(cached.read_text()).get('query',{}).get('pages',{}).values():page_cache[page['title']]=page
entries=list(selection.items())
for start in range(0,len(entries),50):
 batch=entries[start:start+50]
 missing=[title for _,title in batch if title not in page_cache]
 params=dict(action='query',prop='imageinfo',iiprop='url|extmetadata',titles='|'.join(missing),format='json')
 url='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(params)
 path=cache/(hashlib.sha256(params['titles'].encode()).hexdigest()+'.json')
 if not missing:data={'query':{'pages':{}}}
 elif path.exists():data=json.loads(path.read_text())
 else:
  for attempt in range(6):
   try:
    data=json.loads(subprocess.check_output(['curl','-fsSL','--max-time','45','-A','BluffTableVocabulary/1.0',url]))
    if 'query' not in data:raise ValueError(data)
    path.write_text(json.dumps(data));break
   except Exception:
    if attempt==5:raise
    time.sleep(20)
  time.sleep(3)
 page_cache.update({page['title']:page for page in data['query']['pages'].values()})
 pages=page_cache
 for word,title in batch:
  page=pages[title];info=page['imageinfo'][0];meta=info['extmetadata']
  def field(name):return html.unescape(re.sub('<[^>]+>','',meta.get(name,{}).get('value',''))).strip()
  records[word]=dict(word=word,title=title,url=info['url'].split('?')[0],source=info['descriptionurl'],author=author_overrides.get(word) or field('Artist') or field('ImageDescription'),
   license=field('LicenseShortName'),licenseUrl=field('LicenseUrl'),credit=field('Credit'))
 print('Verified provenance',len(records),flush=True)
ids={line.split('\t')[1]:line.split('\t')[0] for line in (RES/'words.tsv').read_text().splitlines()}
for w,r in records.items():r['id']=ids[w]
(RES/'audio-manifest.json').write_text(json.dumps(list(records.values()),ensure_ascii=False,indent=2)+'\n')
body=['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spelling pronunciation credits</title><style>body{max-width:1000px;margin:40px auto;padding:20px;font:16px/1.6 system-ui;background:#100d13;color:#eee}a{color:#ff8299}td,th{padding:12px;text-align:left;border-bottom:1px solid #493340}table{width:100%}</style><h1>Pronunciation credits</h1><p>2,000 challenging English spellings. This is an independent game word list, not an official TOEFL vocabulary. Original recordings are served unchanged from Wikimedia Commons and cached locally on demand. Each recording retains the license listed below; the attribution and license links are part of this distribution. See each source page for additional licensing options and history.</p><p>Word selection by Bluff Table; frequency screening used <a href="https://github.com/hermitdave/FrequencyWords">FrequencyWords by Hermit Dave</a>. Recordings were not synthesized or modified.</p><table><tr><th>Word / original recording</th><th>Author</th><th>License</th></tr>']
for w,r in records.items():
 e=html.escape
 body.append(f'<tr><td><a href="{e(r["source"],quote=True)}">{e(w)}</a></td><td>{e(r["author"])}</td><td><a href="{e(r["licenseUrl"] or r["source"],quote=True)}">{e(r["license"])}</a></td></tr>')
body.append('</table></html>');(RES/'credits.html').write_text('\n'.join(body))
print('Wrote manifest and credits for',len(records),'recordings')
