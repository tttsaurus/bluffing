import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url),loader=require.resolve('tsx')
const script=new URL('../db/clear.ts',import.meta.url).pathname
function run(args,url='postgresql://user:secret@127.0.0.1:1/blufftable_safeqa') {
  return spawnSync(process.execPath,['--import',loader,script,...args],{encoding:'utf8',env:{...process.env,DATABASE_URL:url,DATABASE_URL_UNPOOLED:'',DIRECT_URL:''},timeout:10000})
}
test('reset help never needs a database connection',()=>{const r=run(['--help']);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Usage:/)})
test('dry-run redacts credentials and never connects or deletes',()=>{const r=run(['--dry-run']);assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/secret/);assert.match(r.stdout,/no connection, backup or deletion/)})
for(const name of ['postgres','template0','template1','bad-name','db%3BDROP'])test('reset refuses unsafe target '+name,()=>{const r=run(['--dry-run'],'postgresql://user:secret@127.0.0.1:1/'+name);assert.notEqual(r.status,0);assert.match(r.stderr,/unsafe\/system/)})
for(const arg of ['--yes','--force','--unknown'])test('reset refuses automatic confirmation '+arg,()=>{assert.notEqual(run([arg]).status,0)})
test('noninteractive invocation cannot reach a database or bypass typed confirmation',()=>{const r=run([]);assert.notEqual(r.status,0);assert.match(r.stderr,/Interactive confirmation/);assert.doesNotMatch(r.stderr,/ECONNREFUSED/)})
