#!/usr/bin/env node
// Protocol fixture: no network and no model usage.
const readline = require('node:readline');
const mode = process.env.IRIXI_TRANSLATION_TEST_MODE || 'success';
const reply = (id, result) => process.stdout.write(JSON.stringify({id, result}) + '\n');
const notify = (method, params) => process.stdout.write(JSON.stringify({method, params}) + '\n');
readline.createInterface({input: process.stdin}).on('line', line => {
  const {id, method, params} = JSON.parse(line);
  if (method === 'initialize') reply(id, {});
  if (method === 'account/read') reply(id, {account: {type: mode === 'api' ? 'apiKey' : 'chatgpt'}});
  if (method === 'model/list') reply(id, {data: mode === 'missing-model' ? [] : [
    {model: 'gpt-5.6-luna', supportedReasoningEfforts: [{reasoningEffort: 'low'}]}
  ]});
  if (method === 'config/read') reply(id, {config: {}});
  if (method === 'thread/start') {
    if (params.ephemeral !== true || params.environments.length || params.sandbox !== 'read-only') process.exit(2);
    reply(id, {model: mode === 'wrong-model' ? 'other' : params.model, thread: {id: 'fixture', ephemeral: true}});
  }
  if (method === 'turn/start') {
    if (params.effort !== 'low' || params.model !== 'gpt-5.6-luna') process.exit(3);
    reply(id, {turn: {id: 'turn-fixture'}});
    if (mode === 'quota') return notify('turn/completed', {turn: {status: 'failed', error: {message: 'quota limit'}}});
    if (mode === 'tool') return notify('item/started', {item: {type: 'commandExecution'}});
    setTimeout(() => {
      notify('item/completed', {threadId: 'fixture', item: {type: 'agentMessage', text: '测试解释'}});
      notify('turn/completed', {threadId: 'fixture', turn: {status: 'completed'}});
    }, mode === 'slow' ? 1000 : 10);
  }
});
