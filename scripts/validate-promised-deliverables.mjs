import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
function compile(path, deps = {}, globals = {}) {
 const exports = {};
 vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
 { exports, require: name => name === 'server-only' ? {} : name in deps ? deps[name] : require(name), Buffer, Date, Set, Map, URL, URLSearchParams, Response, AbortSignal, console, ...globals });
 return exports;
}
const policy = compile('lib/call-commitment-policy.ts');
const docsPolicy = compile('lib/approved-document-policy.ts');
const mime = compile('lib/mail-attachments.ts');
const now = new Date('2026-11-26T10:00:00Z');
const old = '2026-11-25T15:45:00Z';
const scope = { userId: 'owner', workspaceId: 'workspace' };
const document = { key: 'adam_brochure', version: '00000000-0000-4000-8000-000000000001', name: 'adam.pdf', size: 10, sha256: 'hash' };
const task = (id = 'task', overrides = {}) => ({ id, workspace_id: 'workspace', owner_id: 'owner', status: 'open', source: 'call', kind: 'commitment', link_kind: 'email', text: 'Send Scott the Adam brochure', created_at: old, due_at: null,
 payload: { ownerType: 'me', preparationKind: 'email', commitmentReminder: true, subject: 'Adam brochure', sourceQuote: 'I will send you the Adam brochure', body: 'Hi Scott, here is the brochure: [To confirm: brochure link or file].', missingDetails: ['Brochure link or file to include in the email.'] }, ...overrides });
assert.equal(policy.callCommitmentNeedsAttention(task(), now), true, 'undated promises require attention');
for (const status of ['done','dismissed']) assert.equal(policy.callCommitmentNeedsAttention(task('t',{status}),now),false);
assert.equal(policy.callCommitmentNeedsAttention(task('t',{payload:{ownerType:'counterparty',preparationKind:'email'}}),now),false);
assert.equal(policy.commitmentReminderDue({read_at:old,created_at:old}, now),true,'reading is not completion');
assert.equal(policy.commitmentReminderDue({dismissed_at:old,created_at:old},now),false);
assert.equal(policy.commitmentReminderDue({snoozed_until:'2026-11-27T10:00:00Z'},now),false);
assert.equal(policy.commitmentReminderWindow(new Date('2026-07-06T08:00:00Z')),true,'London summer time');
assert.equal(policy.commitmentReminderWindow(new Date('2026-11-28T10:00:00Z')),false,'weekend');
assert.equal(docsPolicy.requestedApprovedDocument('Send Scott the Adam brochure'), 'adam_brochure');
assert.equal(docsPolicy.requestedApprovedDocument('Send the brochure'), 'ambiguous');
assert.equal(docsPolicy.requestedApprovedDocument('Send Adam pricing'), 'ambiguous','product-specific prices cannot use a guessed generic price list');
assert.equal(docsPolicy.requestedApprovedDocument('Send a follow-up email'), null);
const pdf = Buffer.from('%PDF-1.4\nhello');
const raw = 'To: scott@example.com\r\nSubject: Test\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="inner"\r\n\r\n--inner\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nHello Scott\r\n--inner\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>Hello Scott</p>\r\n--inner--';
const attached = mime.addMimeAttachments(raw, [{name:'adam.pdf',mimeType:'application/pdf',content:pdf}]);
const parsed = spawnSync('python3', ['-c', "import sys,email,json;from email import policy;m=email.message_from_bytes(sys.stdin.buffer.read(),policy=policy.default);a=list(m.iter_attachments());print(json.dumps({'type':m.get_content_type(),'count':len(a),'name':a[0].get_filename(),'bytes':a[0].get_payload(decode=True).decode(),'plain':m.get_body(preferencelist=('plain',)).get_content().strip()}))"], { input: attached, encoding:'utf8' });
assert.equal(parsed.status,0,parsed.stderr);
assert.deepEqual(JSON.parse(parsed.stdout),{type:'multipart/mixed',count:1,name:'adam.pdf',bytes:pdf.toString(),plain:'Hello Scott'});
assert.throws(()=>mime.addMimeAttachments(raw,[{name:'bad.pdf',mimeType:'application/pdf',content:Buffer.from('not PDF')}]),/PDF/);
let rows, failTable = '', createCount=0, enabled=true, documents=[document], recipients=[{email:'scott@example.com'}], providerFail=false, sentId=null, gate=null;
function at(row,key) { const value=key.includes('->') ? key.replaceAll('->>','->').split('->').reduce((v,k)=>v?.[k],row) : row[key];return key.includes('->>')&&value!=null?String(value):value; }
const db = { from(table) {
 let filters=[], action='read', values, options;
 const q={ select(){return q;}, eq(k,v){filters.push(r=>k==='payload'?JSON.stringify(r[k])===v:at(r,k)===v);return q;}, is(k,v){filters.push(r=>r[k]==v);return q;}, in(k,v){filters.push(r=>v.includes(at(r,k)));return q;}, gt(k,v){filters.push(r=>r[k]>v);return q;}, order(){return q;}, limit(){return q;}, update(v){action='update';values=v;return q;}, upsert(v,o){action='upsert';values=v;options=o;return q;}, maybeSingle(){return run(true);}, then(resolve,reject){return run().then(resolve,reject);} };
 async function run(single=false) {
  if(failTable===table) return {data:null,error:new Error('database read failed')};
  let selected=(rows[table]||[]).filter(r=>filters.every(f=>f(r)));
  if(action==='update')selected.forEach(r=>Object.assign(r,plain(values)));
  if(action==='upsert') {
   const duplicate=rows[table].find(r=>r.user_id===values.user_id&&r.source_event_key===values.source_event_key);
   if(duplicate&&options.ignoreDuplicates)selected=[];
   else {const added={id:'notification-'+rows[table].length,created_at:now.toISOString(),attention_at:now.toISOString(),...plain(values)};rows[table].push(added);selected=[added];}
  }
  if(table==='crm_notifications'&&action==='update') selected.forEach(r=>{r.attention_at=r.snoozed_until||r.created_at;});
  return {data:single?(selected[0]?plain(selected[0]):null):plain(selected),error:null};
 }
 return q;
}};
const reset=()=>{rows={tasks:[task()],workspace_members:[{workspace_id:'workspace',user_id:'owner',status:'active'}],crm_notification_preferences:[],crm_notifications:[]};failTable='';createCount=0;enabled=true;documents=[document];recipients=[{email:'scott@example.com'}];providerFail=false;sentId=null;gate=null;};
const common={'@/lib/supabase':{supabaseService:db},'@/lib/record-scope':{resolveRecordScope:async()=>scope}};
const worker=compile('lib/call-deliverable-drafts.ts',{...common,
 '@/lib/approved-document-policy':docsPolicy,
 '@/lib/approved-documents':{loadApprovedDocuments:async()=>({autoDrafts:enabled,documents}),approvedDocumentBytes:async()=>pdf},
 '@/lib/task-email':{loadTaskEmailWorkspace:async()=>({recipients})},
 '@/lib/gmail':{verifySentCallDeliverable:async()=>sentId},
 '@/lib/mail':{connectedMailProvider:async()=>({provider:'google'}),createConnectedMailDraft:async(input)=>{createCount++;assert.equal(input.attachments.length,1);assert.ok(input.trackingMessageId);assert.doesNotMatch(input.text,/To confirm/);if(gate)await gate;if(providerFail)throw new Error('timeout');return {ok:true,id:'provider-draft',url:'https://mail.google.com/mail/u/0/#drafts'};}},
});
reset(); await Promise.all([worker.prepareCallDeliverableDraft('task'),worker.prepareCallDeliverableDraft('task')]);
assert.equal(createCount,1,'concurrent workers create only one provider draft');
assert.equal(rows.tasks[0].status,'open','draft creation never completes a promise');
assert.equal(rows.tasks[0].payload.deliverableDraft.status,'ready');
await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,1);
sentId='sent-message';await worker.prepareCallDeliverableDraft('task');assert.equal(rows.tasks[0].status,'done');
reset();documents=[];await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,0);assert.match(rows.tasks[0].payload.deliverableDraft.reason,/Upload/);
documents=[document];await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,1,'a later upload unblocks the saved promise');
reset();recipients.push({email:'other@example.com'});await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,0);assert.match(rows.tasks[0].payload.deliverableDraft.reason,/recipient/);
reset();enabled=false;await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,0,'no automatic mailbox writes without personal opt-in');
reset();providerFail=true;await worker.prepareCallDeliverableDraft('task');assert.equal(rows.tasks[0].payload.deliverableDraft.status,'uncertain');providerFail=false;await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,1,'never blindly retry an interrupted provider write');
reset();await worker.prepareCallDeliverableDraft('task');documents=[{...document,version:'00000000-0000-4000-8000-000000000002'}];await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,1);assert.match(rows.tasks[0].payload.deliverableDraft.reason,/changed/,'new approved versions flag existing drafts without overwriting edits');
reset();rows.tasks[0].payload.missingDetails.push('Confirm vacancy uploads');await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,0,'unverified product claims stay blocked');
reset();rows.tasks[0].text='Email Scott the proposal';Object.assign(rows.tasks[0].payload,{subject:'Proposal',sourceQuote:'I will email a proposal',body:'The proposal is attached.',missingDetails:[]});await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,0,'attachment claims require a real approved file');
reset();rows.tasks[0].owner_id='another-owner';await worker.prepareCallDeliverableDraft('task');assert.equal(createCount,0,'cross-account task IDs cannot create drafts');
const notifications=compile('lib/crm-notifications.ts');
let draftChecks=0;
const reminders=compile('lib/call-commitment-reminders.ts',{...common,'@/lib/call-commitment-policy':policy,'@/lib/crm-notifications':notifications,'@/lib/call-deliverable-drafts':{prepareCallDeliverableDraft:async()=>draftChecks++}});
reset();rows.tasks.push(task('other',{owner_id:'someone-else'}));await reminders.runCallCommitmentReminders(now);assert.equal(rows.crm_notifications.length,1);
await reminders.runCallCommitmentReminders(now);assert.equal(rows.crm_notifications.length,1,'stable receipt on cron retries');
rows.crm_notifications[0].read_at=now.toISOString();await reminders.runCallCommitmentReminders(new Date('2026-11-26T12:00:00Z'));assert.equal(rows.crm_notifications[0].read_at,null,'reading does not silence an overdue promise');
rows.crm_notifications[0].snoozed_until='2026-11-27T10:00:00Z';const before=draftChecks;await reminders.runCallCommitmentReminders(new Date('2026-11-26T14:00:00Z'));assert.equal(draftChecks,before,'explicit snooze pauses draft work as well as reminders');
rows.crm_notifications[0].snoozed_until=null;rows.tasks[0].status='done';await reminders.runCallCommitmentReminders(now);assert.ok(rows.crm_notifications[0].dismissed_at,'completed tasks retire their alert');
reset();failTable='crm_notification_preferences';await assert.rejects(reminders.runCallCommitmentReminders(now));assert.equal(rows.crm_notifications.length,0,'read failures cannot be treated as default permission');
// Real sent-evidence verification: a matching draft header alone is insufficient.
const body='Hello Scott';const hash=value=>createHash('sha256').update(value).digest('hex');
let sentBody=body, includeAttachment=true;
const tracking='<lc-deliverable-00000000-0000-4000-8000-000000000001@livecoach.invalid>';
const gmail=compile('lib/gmail.ts',{'@/lib/google':{getAccessToken:async()=>'test-token'},'@/lib/mail-attachments':mime},{fetch:async(url)=>{
 const p=new URL(url);let response;
 if(p.pathname.endsWith('/attachments/file'))response={data:pdf.toString('base64url')};
 else if(p.pathname.endsWith('/messages/sent'))response={id:'sent',labelIds:['SENT'],payload:{headers:[{name:'Message-ID',value:tracking},{name:'To',value:'scott@example.com'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from(sentBody).toString('base64url')}},...(includeAttachment?[{filename:'adam.pdf',body:{size:pdf.length,attachmentId:'file'}}]:[])]}};
 else response={messages:[{id:'sent'}]};
 return Response.json(response);
}});
const evidence={trackingMessageId:tracking,recipient:'scott@example.com',bodyHash:hash(body),documents:[{name:'adam.pdf',size:pdf.length,sha256:hash(pdf)}]};
assert.equal(await gmail.verifySentCallDeliverable(evidence,'owner'),'sent');
includeAttachment=false;assert.equal(await gmail.verifySentCallDeliverable(evidence,'owner'),null,'sent acknowledgement with attachment removed does not fulfil a promise');
includeAttachment=true;sentBody='Thanks, will send later';assert.equal(await gmail.verifySentCallDeliverable(evidence,'owner'),null,'changed acknowledgement does not count as promised delivery');
// Upload approval reads the actual private blob and pins its immutable digest.
let savedConfig=null, storedBytes=pdf;
const storageDb={...db,storage:{from:()=>({download:async()=>({data:new Blob([storedBytes]),error:null})})}};
const approved=compile('lib/approved-documents.ts',{
 ...common,'@/lib/supabase':{supabaseService:storageDb},'@/lib/approved-document-policy':docsPolicy,
 '@/lib/app-config':{setAppConfigValue:async input=>{savedConfig=input;}},
},{Blob});
const uploaded=await approved.approveUploadedDocument({key:'adam_brochure',version:document.version,name:'adam.pdf',size:pdf.length});
assert.equal(uploaded.sha256,hash(pdf));assert.equal(savedConfig.visibility,'private');
assert.equal((await approved.approvedDocumentBytes(uploaded)).toString(),pdf.toString());
await assert.rejects(approved.approvedDocumentBytes({...uploaded,path:'users/another-owner/secret.pdf'}),/access/);
storedBytes=Buffer.from('%PDF-wrong but same length');await assert.rejects(approved.approvedDocumentBytes(uploaded),/changed/);
storedBytes=Buffer.from('not a PDF');await assert.rejects(approved.approveUploadedDocument({key:'adam_brochure',version:document.version,name:'adam.pdf',size:storedBytes.length}),/valid PDF/);
console.log('Promised follow-ups: scoped reminders, repeat/snooze/completion, private PDF upload/hash checks, document matching, MIME integrity, opt-in, blocked recovery, concurrent drafts, interrupted writes, version changes and verified sent delivery passed');
