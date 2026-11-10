
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDocs, writeBatch,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCHrFvDfWRbfHF2mU30f0ck4yAMccK3JA0",
  authDomain: "live-customer-ledger.firebaseapp.com",
  projectId: "live-customer-ledger",
  appId: "1:103677921961:web:cf0a7385d30f89c7d737b8"
};
let app=null,auth=null,db=null,unsubscribe=null,currentUser=null,writeQueue=Promise.resolve();
const $=id=>document.getElementById(id);

function setState(text,mode='warn'){
  const el=$('cloudState'); if(!el)return;
  el.textContent=text; el.className='cloudstate '+(mode==='online'?'online':'warn');
}
function msg(text,bad=false){
  const el=$('cloudMessage');if(!el)return;
  el.textContent=text;el.style.color=bad?'#dc2626':'#166534';
}
async function initFirebase(){
  if(app) return;
  app=initializeApp(FIREBASE_CONFIG);
  auth=getAuth(app); db=getFirestore(app);
  onAuthStateChanged(auth, async user=>{
    currentUser=user||null;
    if(user){
      setState('☁️ 已登录 · '+user.email,'online');
      $('cloudLoginBtn').style.display='none';
      $('cloudSyncBtn').style.display='';
      $('cloudLogoutBtn').style.display='';
      window.cloudReady=true;
      try{
        await initialMergeAndSync();
        if(currentUser?.uid!==user.uid)return;
        subscribeRealtime();
        closeCloudModal();
      }catch(error){
        if(currentUser?.uid===user.uid)setState('☁️ 同步失败 · 可点立即同步重试','warn');
      }
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
async function ensureConfig(){
  await initFirebase();
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
function pushAll(localBills,deletedIds=[]){
  if(!currentUser||!db)return Promise.resolve();
  const uid=currentUser.uid;
  const deleted=new Set(deletedIds.map(String));
  const writes=localBills.filter(b=>!deleted.has(String(b.id))).map(b=>({
    id:String(b.id),data:structuredClone(b)
  }));
  const changes=[...Array.from(deleted,id=>({id})),...writes];
  const pending=writeQueue.catch(()=>{}).then(async()=>{
    if(currentUser?.uid!==uid||!changes.length)return;
    for(let start=0;start<changes.length;start+=450){
      const batch=writeBatch(db);
      const chunk=changes.slice(start,start+450);
      for(const {id,data} of chunk){
        const ref=doc(db,'users',uid,'bills',id);
        if(data)batch.set(ref,data,{merge:true});
        else batch.delete(ref);
      }
      await batch.commit();
      if(currentUser?.uid!==uid)return;
      window.clearDeletedBillIds?.(chunk.filter(change=>!change.data).map(change=>change.id));
    }
  });
  writeQueue=pending;
  return pending.catch(error=>{
    if(currentUser?.uid===uid)setState('☁️ 同步失败 · 可点立即同步重试','warn');
    throw error;
  });
}
window.cloudPushAll=pushAll;
async function initialMergeAndSync(){
  setState('☁️ 正在同步…','warn');
  const uid=currentUser.uid;
  const remote=await fetchRemote();
  if(currentUser?.uid!==uid)return;
  const local=window.getLedgerBills?.()||[];
  const deleted=window.getDeletedBillIds?.()||[];
  const deletedSet=new Set(deleted.map(String));
  const merged=mergeById(local,remote).filter(b=>!deletedSet.has(String(b.id)));
  window.replaceLedgerBills?.(merged);
  await pushAll(merged,deleted);
  if(currentUser?.uid===uid)setState('☁️ 已同步 · '+currentUser.email,'online');
}
function subscribeRealtime(){
  if(unsubscribe)unsubscribe();
  unsubscribe=onSnapshot(billsCol(),snap=>{
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
    subscribeRealtime();
    alert('同步完成');
  }catch(e){alert('同步失败：'+(e.message||e))}
};

// Initialize the built-in Firebase connection. Auth restores prior login automatically.
initFirebase().catch(()=>setState('☁️ 云端连接异常','warn'));
