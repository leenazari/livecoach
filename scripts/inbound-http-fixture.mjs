import http from 'node:http';
import { createInboundFixture } from './inbound-test-fixture.mjs';
const fixture=await createInboundFixture();const {db,workspace,owner}=fixture;
const allowedTables=new Set(['workspaces','workspace_members','profiles','marketing_campaigns','marketing_leads','inbound_lead_settings','inbound_lead_keys','inbound_leads','inbound_lead_events']);
const identifier=v=>{if(!/^[a-z_][a-z0-9_]*$/.test(v))throw Error('Invalid identifier');return `"${v}"`;};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const send=(status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(req.method==='HEAD'?undefined:JSON.stringify(data));};
 try {
  if(url.pathname==='/auth/v1/user') {const bearer=(req.headers.authorization||'').replace('Bearer ','');let sub;try{sub=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url').toString()).sub;}catch{}if(!sub)return send(401,{message:'Invalid fixture session'});return send(200,{id:sub,aud:'authenticated',role:'authenticated',email:'fixture@example.com',created_at:new Date().toISOString(),app_metadata:{},user_metadata:{},identities:[]});}
  if(url.pathname.startsWith('/auth/')) return send(200,{});
  const service=req.headers.authorization==='Bearer fixture-service';let userId=owner;
  if(!service){try{userId=JSON.parse(Buffer.from((req.headers.authorization||'').replace('Bearer ','').split('.')[1],'base64url').toString()).sub;}catch{return send(401,{message:'No fixture identity'});}}
  const result=await db.transaction(async tx=>{
   await tx.exec(`set local role ${service?'service_role':'authenticated'}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
   if(req.method==='POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
    const name=url.pathname.split('/').pop();if(!['inbound_admin_command','inbound_review_command','inbound_integration_command'].includes(name))return {data:null};
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());const entries=Object.entries(body);
    const {rows}=await tx.query(`select public.${identifier(name)}(${entries.map(([key],i)=>`${identifier(key)} => $${i+1}`).join(',')}) as value`,entries.map(([,value])=>value));return {data:rows[0].value};
   }
   const table=url.pathname.split('/').pop();if(!allowedTables.has(table))return {data:[],count:0};
   const selected=url.searchParams.get('select')||'*';const columns=selected==='*'?'*':selected.split(',').map(identifier).join(',');const filters=[],values=[];
   for(const [key,value] of url.searchParams){if(['select','order','limit','offset'].includes(key))continue;const column=identifier(key);const add=v=>{values.push(v);return `$${values.length}`;};
    if(value.startsWith('eq.'))filters.push(`${column}=${add(value.slice(3))}`);
    else if(value.startsWith('in.('))filters.push(`${column} in (${value.slice(4,-1).split(',').map(add).join(',')})`);
    else if(value.startsWith('ilike.'))filters.push(`${column} ilike ${add(value.slice(6))}`);
    else if(value==='is.null')filters.push(`${column} is null`);else throw Error('Unsupported fixture filter');
   }
   const where=filters.length?' where '+filters.join(' and '):'';const count=(await tx.query(`select count(*)::int as n from public.${identifier(table)}${where}`,values)).rows[0].n;
   const sort=url.searchParams.get('order');let suffix='';if(sort)suffix=' order by '+sort.split(',').map(v=>{const [col,dir]=v.split('.');return identifier(col)+(dir==='desc'?' desc':' asc');}).join(',');
   const limit=Number(url.searchParams.get('limit')||1000),offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(limit)||!Number.isSafeInteger(offset))throw Error('Invalid fixture page');
   const rows=(await tx.query(`select ${columns} from public.${identifier(table)}${where}${suffix} limit ${limit} offset ${offset}`,values)).rows;
   return {data:rows,count};
  });
  if((req.headers.accept||'').includes('application/vnd.pgrst.object+json') && Array.isArray(result.data)){if(result.data.length!==1)return send(406,{code:'PGRST116',message:'JSON object requested, multiple (or no) rows returned',details:`The result contains ${result.data.length} rows`});return send(200,result.data[0]);}
  return send(200,result.data,{'content-range':`0-${Math.max(0,(result.data?.length||0)-1)}/${result.count||0}`});
 }catch(e){return send(400,{message:e.message,code:e.code||'FIXTURE'});}
});
server.listen(54325,'127.0.0.1',()=>console.log('Local-only Supabase-shaped HTTP fixture listening on 54325'));
process.on('SIGTERM',async()=>{server.close();await db.close();process.exit(0);});
