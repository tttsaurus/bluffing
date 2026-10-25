import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
const require=createRequire(import.meta.url),loader=require.resolve('tsx')
function fixture(env={}) {
  const root=mkdtempSync(join(tmpdir(),'bluff-ts-dev-')),calls=join(root,'calls')
  for(const path of ['scripts/db','scripts/network','server/src','node_modules/vite/bin'])mkdirSync(join(root,path),{recursive:true})
  writeFileSync(join(root,'package.json'),'{"type":"module"}')
  symlinkSync(dirname(require.resolve('tsx/package.json')),join(root,'node_modules/tsx'))
  copyFileSync(new URL('../dev.ts',import.meta.url),join(root,'scripts/dev.ts'))
  writeFileSync(join(root,'server/src/config.ts'),'export const port=()=>Number(process.env.PORT);export const databaseUrl=()=>"unused";')
  writeFileSync(join(root,'scripts/db/migrate.ts'),'import{appendFileSync}from"node:fs";export async function migrate(){appendFileSync(process.env.CALLS,"migration\\n");if(process.env.FAIL_MIGRATION)throw Error("Migration failed");}')
  writeFileSync(join(root,'scripts/network/tailscale.ts'),'export async function checkTailnet(){if(process.env.FAIL_TAILNET)throw Error("Tailscale is not connected");}export async function enableTailnet(){}')
  writeFileSync(join(root,'node_modules/vite/package.json'),'{"name":"vite","version":"1.0.0","type":"module"}')
  const code=`import {createServer} from 'node:http';import{appendFileSync}from'node:fs';
const role=process.argv.includes('--host')?'frontend':'backend';
if(process.env['FAIL_'+role.toUpperCase()])process.exit(role==='backend'?17:18);
appendFileSync(process.env.CALLS,role+' started\\n');
const server=createServer((req,res)=>{appendFileSync(process.env.CALLS,role+' healthy\\n');res.end('ok')});
server.listen(role==='backend'?Number(process.env.PORT):5173,'127.0.0.1');
process.on('SIGTERM',()=>{appendFileSync(process.env.CALLS,role+' stopped\\n');server.close(()=>process.exit(0))});`
  writeFileSync(join(root,'server/src/local.ts'),code);writeFileSync(join(root,'node_modules/vite/bin/vite.js'),code)
  let output='',child
  const environment={...process.env,PORT:'45871',BLUFF_STARTUP_TIMEOUT:'5',CALLS:calls,...env}
  return {root,calls,get output(){return output},environment,
    start(args=[]){child=spawn(process.execPath,['--import',loader,join(root,'scripts/dev.ts'),...args],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);return child},
    log(){return existsSync(calls)?readFileSync(calls,'utf8'):''},
    async wait(text){const end=Date.now()+12000;while(Date.now()<end){if(output.includes(text))return;await new Promise(resolve=>setTimeout(resolve,30))}throw Error(output)},
    async clean(){if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}rmSync(root,{recursive:true,force:true})}}
}
test('launcher help and invalid flags do not migrate or start a server',async()=>{
  const f=fixture()
  try{for(const args of [['--help'],['--invalid']]){const result=spawnSync(process.execPath,['--import',loader,join(f.root,'scripts/dev.ts'),...args],{cwd:f.root,env:f.environment,encoding:'utf8'});assert.equal(result.status,args[0]==='--help'?0:1);assert.equal(f.log(),'')}}finally{await f.clean()}
})
test('backend health precedes frontend startup; TERM cleans both and its own PID file',async()=>{
  const f=fixture()
  try{f.start();await f.wait('Bluff Table is ready');const log=f.log();assert.ok(log.indexOf('backend healthy')<log.indexOf('frontend started'));assert.ok(existsSync(join(f.root,'.local/app.pid')))}finally{await f.clean()}
})
for(const [env,message] of [[{FAIL_MIGRATION:'1'},'Migration failed'],[{FAIL_TAILNET:'1'},'Tailscale is not connected'],[{FAIL_BACKEND:'1'},'A development server stopped'],[{FAIL_FRONTEND:'1'},'A development server stopped']]) {
 test('startup failure cleans up safely: '+Object.keys(env)[0],async()=>{
   const f=fixture(env)
   try{const child=f.start(env.FAIL_TAILNET?['--tailnet']:[]);await new Promise(resolve=>child.once('exit',resolve));assert.notEqual(child.exitCode,0,f.output);assert.match(f.output,new RegExp(message));if(env.FAIL_TAILNET||env.FAIL_MIGRATION)assert.doesNotMatch(f.log(),/started/);if(env.FAIL_FRONTEND)assert.match(f.log(),/backend stopped/)}finally{await f.clean()}
 })
}
