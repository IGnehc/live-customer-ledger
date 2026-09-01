
import { initializeApp, getApps, deleteApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDocs, setDoc, deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const CFG_KEY='live_ledger_firebase_config_v5';
let app=null,auth=null,db=null,unsubscribe=null,currentUser=null,suppressSnapshot=false;
const $=id=>document.getElementById(id);

function setState(text,mode='warn'){
  const el=$('cloudState'); if(!el)return;
  el.textContent=text; el.className='cloudstate '+(mode==='online'?'online':'warn');
}
function msg(text,bad=false){
  const el=$('cloudMessage');if(!el)return;
  el.textContent=text;el.style.color=bad?'#dc2626':'#166534';
}
function readConfig(){
  try{return JSON.parse(localStorage.getItem(CFG_KEY)||'{}')}catch{return {}}
}
function configFromForm(){
  return {
    apiKey:$('fbApiKey').value.trim(),
    authDomain:$('fbAuthDomain').value.trim(),
    projectId:$('fbProjectId').value.trim(),
    appId:$('fbAppId').value.trim()
  };
}
window.loadCloudForm=()=>{
  const c=readConfig();
  $('fbApiKey').value=c.apiKey||'';
  $('fbAuthDomain').value=c.authDomain||'';
  $('fbProjectId').value=c.projectId||'';
  $('fbAppId').value=c.appId||'';
};
async function initFirebase(config){
  if(app){
    try{if(unsubscribe)unsubscribe(); await deleteApp(app)}catch{}
    app=auth=db=null;
  }
  app=initializeApp(config,'ledger-'+Date.now());
  auth=getAuth(app); db=getFirestore(app);
  onAuthStateChanged(auth, async user=>{
    currentUser=user||null;
    if(user){
      setState('☁️ 已登录 · '+user.email,'online');
      $('cloudLoginBtn').style.display='none';
      $('cloudSyncBtn').style.display='';
      $('cloudLogoutBtn').style.display='';
      window.cloudReady=true;
      await initialMergeAndSync();
      subscribeRealtime();
      closeCloudModal();
    }else{
      setState('☁️ 未登录','warn');
      $('cloudLoginBtn').style.display='';
      $('cloudSyncBtn').style.display='none';
      $('cloudLogoutBtn').style.display='none';
      window.cloudReady=false;
      if(unsubscribe){unsubscribe();unsubscribe=null}
    }
  });
}
function validConfig(c){return c.apiKey&&c.authDomain&&c.projectId&&c.appId}
async function ensureConfig(){
  const c=configFromForm();
  if(!validConfig(c)) throw new Error('请完整填写 Firebase 配置');
  localStorage.setItem(CFG_KEY,JSON.stringify(c));
  await initFirebase(c);
}
function billsCol(){return collection(db,'users',currentUser.uid,'bills')}
async function fetchRemote(){
  const snap=await getDocs(billsCol());
  return snap.docs.map(d=>d.data());
}
function mergeById(local,remote){
  const m=new Map();
  [...remote,...local].forEach(b=>{
    const id=String(b.id);
    const old=m.get(id);
    if(!old || Number(b.updatedAt||0)>=Number(old.updatedAt||0)) m.set(id,{...b,id:Number(b.id)||b.id});
  });
  return [...m.values()].sort((a,b)=>Number(b.id)-Number(a.id));
}
async function pushAll(localBills,deletedIds=[]){
  if(!currentUser||!db)return;
  const deletes=(deletedIds||[]).map(async id=>{
    await deleteDoc(doc(db,'users',currentUser.uid,'bills',String(id)));
    return String(id);
  });
  const done=await Promise.all(deletes);
  if(done.length) window.clearDeletedBillIds?.(done);

  for(const b of (localBills||[])){
    const payload={...b,updatedAt:Number(b.updatedAt||Date.now())};
    await setDoc(doc(db,'users',currentUser.uid,'bills',String(b.id)),payload,{merge:true});
  }
}
window.cloudPushAll=pushAll;
window.cloudDeleteOne=async id=>{
  if(currentUser&&db) await deleteDoc(doc(db,'users',currentUser.uid,'bills',String(id)));
};
async function initialMergeAndSync(){
  setState('☁️ 正在同步…','warn');
  const local=window.getLedgerBills?.()||[];
  const remote=await fetchRemote();
  const deleted=window.getDeletedBillIds?.()||[];
  const deletedSet=new Set(deleted.map(String));
  const merged=mergeById(local,remote).filter(b=>!deletedSet.has(String(b.id)));
  window.replaceLedgerBills?.(merged);
  await pushAll(merged,deleted);
  setState('☁️ 已同步 · '+currentUser.email,'online');
}
function subscribeRealtime(){
  if(unsubscribe)unsubscribe();
  unsubscribe=onSnapshot(billsCol(),snap=>{
    if(suppressSnapshot)return;
    const remote=snap.docs.map(d=>d.data());
    const local=window.getLedgerBills?.()||[];
    const deletedSet=new Set((window.getDeletedBillIds?.()||[]).map(String));
    const merged=mergeById(local,remote).filter(b=>!deletedSet.has(String(b.id)));
    window.replaceLedgerBills?.(merged);
    setState('☁️ 已同步 · '+currentUser.email,'online');
  },err=>setState('☁️ 同步异常','warn'));
}
window.firebaseCloudRegister=async()=>{
  try{
    msg('正在注册…');
    await ensureConfig();
    const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;
    if(!email||password.length<6) throw new Error('请输入邮箱，密码至少 6 位');
    await createUserWithEmailAndPassword(auth,email,password);
    msg('注册成功，正在同步');
  }catch(e){msg(e.message||'注册失败',true)}
};
window.firebaseCloudLogin=async()=>{
  try{
    msg('正在登录…');
    await ensureConfig();
    const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;
    if(!email||!password) throw new Error('请输入邮箱和密码');
    await signInWithEmailAndPassword(auth,email,password);
    msg('登录成功');
  }catch(e){msg(e.message||'登录失败',true)}
};
window.firebaseCloudLogout=async()=>{
  try{if(auth)await signOut(auth)}catch{}
};
window.firebaseManualSync=async()=>{
  try{
    if(!currentUser)return alert('请先登录');
    await initialMergeAndSync();
    alert('同步完成');
  }catch(e){alert('同步失败：'+(e.message||e))}
};

// Auto-load saved config. Firebase Auth will restore prior login session automatically.
const saved=readConfig();
if(validConfig(saved)){
  initFirebase(saved).catch(()=>setState('☁️ 云端配置异常','warn'));
}else{
  setState('☁️ 未连接云端','warn');
}
