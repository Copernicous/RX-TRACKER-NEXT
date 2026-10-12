'use strict';
const assert = require('node:assert/strict');
if (process.env.DB_HOST !== '127.0.0.1' || (process.env.DB_PORT !== '55439' && process.env.RX_LOCAL_RELEASE_TEST !== '1') || process.env.DB_NAME !== 'rx_next_ci_regression_test') throw Error('Requires the isolated import test cluster.');
process.env.APP_ENV = 'staging'; process.env.IMPORT_REVIEW_V2 = 'true';
const db = require('../models'), controller = require('../controllers/importController');
const files = require('../services/importCorrectionFiles'), csv = require('../public/js/import-review-model');
const retained = require('../utils/retainedImportFile');
const prefix = 'FILES-' + Date.now() + '-';
const headers = ['patientCode','firstName','lastName','dob','phone','notes'];
let user, other; let count = 0;
const pass = label => { count++; console.log('PASS ' + label); };
function req(rows, body = {}, owner = user) {
    const columns = [...new Set([...headers, ...rows.flatMap(r => Object.keys(r))])];
    return { params:{dataset:'patients'}, query:{}, file:{originalname:'synthetic-files.csv',buffer:Buffer.from(csv.encode(columns,rows))},
        body:{reviewMode:'merge',reviewVersion:'2',...body}, user:{id:owner.id,role:'Administrator'}, ip:'127.0.0.1' };
}
async function call(method, request) {
    let output, status = 200, responseHeaders = {};
    await controller[method](request, { status(c){status=c;return this;}, setHeader(k,v){responseHeaders[k]=v;}, json(v){output=v;}, send(v){output=v;} }, () => {});
    return {data:output,status,headers:responseHeaders};
}
async function main() {
    const role = await db.Role.findOne({where:{name:'Administrator'}});
    for (const name of ['USER','OTHER']) {
        const account = await db.User.create({username:prefix+name,firstName:'Synthetic',lastName:name,roleId:role.id,passwordHash:'not-a-login',isActive:true});
        if (name==='USER') user=account;else other=account;
    }
    const rows = [1,2].map(n=>({patientCode:prefix+n,firstName:prefix+n,lastName:'EXAMPLE',dob:n===1?'1980-01-02':'1982-03-04',phone:'305555017'}));
    const request=req(rows), before=await db.Patient.count();
    const historyBefore=await db.AuditLog.count({where:{action:'Patient import report'}});
    let result=await call('saveCorrectionFile',request);assert.equal(result.status,200);const id=result.data.ids[0];assert(id);
    assert.equal(await db.Patient.count(),before);assert.equal(await db.AuditLog.count({where:{action:'Patient import report'}}),historyBefore);pass('retaining error file writes no patient and does not alter Import History');
    result=await call('saveCorrectionFile',request);assert.deepEqual(result.data.ids,[id]);assert.equal(await db.AuditLog.count({where:{userId:user.id,action:files.FILE}}),1);pass('identical repeated previews reuse the correction file');
    const repeated = await Promise.all([call('saveCorrectionFile', request), call('saveCorrectionFile', request)]);assert(repeated.every(r => r.status === 200 && r.data.ids[0] === id));assert.equal(await db.AuditLog.count({where:{userId:user.id,action:files.FILE}}),1);pass('concurrent identical previews reuse one correction record');
    result=await call('getCorrectionFile',{...request,params:{id}});assert.equal(result.data.rows.length,2);const packet=result.data;pass('stored correction CSV retains original fields, errors and source references');
    const wrong=await call('getCorrectionFile',{...request,params:{id},user:{id:other.id,role:'Administrator'}});assert.equal(wrong.status,400);pass('another importer cannot read or resolve a correction file');
    result=await call('downloadCorrectionOriginalFile',{...request,params:{id}});assert.equal(Buffer.compare(result.data,request.file.buffer),0);assert.match(result.headers['Content-Disposition'],/-imported-\d{4}-\d{2}-\d{2}\.csv/);pass('retained original download is byte-identical and dated');
    const edited={...packet.rows[0],phone:'3055550177'};
    const second={...packet.rows[1],phone:'123'};
    result=await call('saveCorrectionFile',req([second]));assert.deepEqual(result.data.ids,[id]);
    result=await call('getCorrectionFile',{...request,params:{id}});assert.equal(result.data.rows.length,2);assert.equal(result.data.rows[1].phone,'123');pass('failed correction updates error file without closing any pending row');
    const originalResolve=files.resolve;
    files.resolve=async(...args)=>{await originalResolve(...args);throw Error('Synthetic correction-link rollback');};
    try { result=await call('importDataset',req([edited]));assert.equal(result.status,500); } finally {files.resolve=originalResolve;}
    result=await call('getCorrectionFile',{...request,params:{id}});assert.equal(result.data.rows.length,2);assert.equal(await db.Patient.count(),before);pass('failed transaction rolls back patient, report and correction resolution together');
    result=await call('importDataset',req([edited]));assert.equal(result.data.successCount,1);const reportId=result.data.reportId;
    result=await call('getCorrectionFile',{...request,params:{id}});assert.equal(result.data.rows.length,1);assert.equal(result.data.rows[0]._reviewItemId,packet.rows[1]._reviewItemId);pass('successful correction removes only its saved row from Files to Correct');
    result=await call('downloadOriginalSourceFile',{...request,params:{id:reportId}});assert.equal(Buffer.compare(result.data,request.file.buffer),0);pass('Import History links to the original upload after corrected-only save');
    result=await call('downloadUploadedFile',{...request,params:{id:reportId}});assert.equal(Buffer.compare(result.data,req([edited]).file.buffer),0);pass('corrected uploaded CSV is also retained byte-for-byte');
    result=await call('getPatientReport',{...request,params:{id:reportId}});assert(!result.data.sourceFile);assert(!result.data.uploadedFile);assert(result.data.hasUploadedFile);pass('ordinary report response does not embed retained original file content');
    result=await call('listCorrectionFiles',request);assert.equal(result.data.files[0].pendingCount,1);assert.equal(result.data.files[0].correctedUploads[0].reportId,reportId);pass('corrected upload is linked to its original error file and saved report');
    result=await call('importDataset',req([edited]));assert.equal(result.status,400);assert.equal(await db.Patient.count(),before+1);pass('re-uploading an already resolved row cannot create or merge again');
    const pending={...packet.rows[1],phone:'3055550178'};
    result=await call('importDataset',req([pending],{reviewDecisions:JSON.stringify([{row:2,action:'skip'}])}));assert.equal(result.data.skippedCount,1);
    result=await call('getCorrectionFile',{...request,params:{id}});assert.equal(result.data.rows.length,1);pass('skipped correction remains pending');
    const parallel=await Promise.all([call('importDataset',req([pending])),call('importDataset',req([pending]))]);
    assert.equal(parallel.filter(r=>r.data.successCount===1).length,1);assert.equal(parallel.filter(r=>r.status===400).length,1);
    result=await call('getCorrectionFile',{...request,params:{id}});assert.equal(result.data.rows.length,0);pass('concurrent retries resolve a correction exactly once');
    const tampered={...pending,_reviewItemId:'a'.repeat(32)};result=await call('importDataset',req([tampered]));assert.equal(result.status,400);pass('forged correction reference is rejected');
    const historic=await db.AuditLog.create({userId:user.id,module:'Data Import',action:'Patient import report',newValue:{schemaVersion:1,fileName:'older.csv',reportRows:[]}});
    result=await call('downloadUploadedFile',{...request,params:{id:historic.id}});assert.equal(result.status,404);await historic.reload();assert.equal(historic.newValue.schemaVersion,1);pass('older history is unchanged; originals are not invented or backfilled');
    const time=retained.capture(request.file,new Date('2026-10-13T02:00:00Z'));assert.match(time.downloadName,/-2026-10-12\.csv$/);pass('filename date follows New York calendar across UTC midnight');
    process.env.IMPORT_REVIEW_V2='false';result=await call('listCorrectionFiles',request);assert.equal(result.status,404);process.env.IMPORT_REVIEW_V2='true';pass('switch off hides file-management endpoints without deleting records');
    console.log('PASS '+count+' file-management PostgreSQL scenarios');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    const patients=await db.Patient.findAll({where:{patientCode:{[db.Sequelize.Op.like]:prefix+'%'}},attributes:['id'],raw:true});
    const ids=patients.map(p=>p.id);
    if(ids.length){for(const name of ['PatientTagAssignment','PatientServiceDateHistory','PatientServiceDateCycle'])await db[name].destroy({where:{patientId:ids}});await db.Patient.destroy({where:{id:ids}});}
    for(const account of [user,other].filter(Boolean)){await db.AuditLog.destroy({where:{userId:account.id}});await db.User.destroy({where:{id:account.id}});}
    await db.sequelize.close();
});
