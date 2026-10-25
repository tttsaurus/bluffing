import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
for(const target of ['', 'postgresql://user@127.0.0.1:1/postgres','postgresql://user@127.0.0.1:1/blufftable','postgresql://user@127.0.0.1:1/production_qa']) {
  test('integration refuses non-disposable target '+target,()=>{
    const result=spawnSync('bash',[new URL('../ci/integration.sh',import.meta.url).pathname],{encoding:'utf8',env:{...process.env,TEST_DATABASE_URL:target},timeout:10000})
    assert.notEqual(result.status,0);assert.match(result.stderr,/disposable blufftable_\*qa/);assert.doesNotMatch(result.stderr,/ECONNREFUSED/)
  })
}
