import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
function run(args=[],failure='') {
  const root=mkdtempSync(join(tmpdir(),'bluff-ts-build-'))
  try {
    mkdirSync(join(root,'scripts'));mkdirSync(join(root,'bin'))
    copyFileSync(new URL('../build.sh',import.meta.url),join(root,'scripts/build.sh'))
    const log=join(root,'calls')
    writeFileSync(join(root,'bin/npm'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\nif [ "$1" = "$FAIL" ]; then exit 17; fi\n',{mode:0o755})
    const result=spawnSync('bash',[join(root,'scripts/build.sh'),...args],{encoding:'utf8',env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,CALLS:log,FAIL:failure}})
    let calls=[];try{calls=readFileSync(log,'utf8').trim().split('\n')}catch{}
    return {...result,calls}
  } finally {rmSync(root,{recursive:true,force:true})}
}
test('one root build installs locked dependencies and builds both TypeScript workspaces',()=>{const r=run();assert.equal(r.status,0,r.stderr);assert.deepEqual(r.calls,['ci --include=optional','run build'])})
test('installation failure prevents builds',()=>{const r=run([],'ci');assert.equal(r.status,17);assert.equal(r.calls.length,1)})
test('build failure is propagated',()=>{assert.equal(run([],'run').status,17)})
test('help and invalid build flags perform no installation or build',()=>{assert.equal(run(['--help']).status,0);assert.deepEqual(run(['--help']).calls,[]);assert.equal(run(['--invalid']).status,2)})
