import React, { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

// ── Responsive hooks ─────────────────────────────────────────────────────────
function useIsMobile(){
  const [m,setM]=useState(()=>typeof window!=="undefined"&&window.innerWidth<768);
  useEffect(()=>{ const h=()=>setM(window.innerWidth<768); window.addEventListener("resize",h); return()=>window.removeEventListener("resize",h); },[]);
  return m;
}
function useIsTablet(){
  const [t,setT]=useState(()=>typeof window!=="undefined"&&window.innerWidth<1024);
  useEffect(()=>{ const h=()=>setT(window.innerWidth<1024); window.addEventListener("resize",h); return()=>window.removeEventListener("resize",h); },[]);
  return t;
}

// ── Supabase (direct REST, hardcoded creds — dedicated stock-tracker project) ──
const SUPA_URL = "https://tpeffpenponsufclvyvo.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwZWZmcGVucG9uc3VmY2x2eXZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTk3NDQsImV4cCI6MjA5Njc5NTc0NH0.g_qr4rzg7pojunRetY_0Jbw5BfqrB8GAL31X9DMjdZw";
const H = {
  "Content-Type":"application/json",
  "apikey":SUPA_KEY,
  "Authorization":`Bearer ${SUPA_KEY}`,
  "Prefer":"return=representation",
};
async function sbFetch(path, opts={}) {
  let res;
  try {
    res = await fetch(`${SUPA_URL}/rest/v1${path}`, { headers:H, ...opts });
  } catch (netErr) {
    // fetch only rejects on a real network/DNS/CORS failure
    throw new Error("Network error: could not reach the database. Check your internet connection.");
  }
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${body || res.statusText || "request failed"}`);
  return body ? JSON.parse(body) : [];
}
const enc = encodeURIComponent;

// ── Auth (logs in against the app_users table in this project) ────────────────
const auth = {
  login: (email,password) => sbFetch(`/app_users?email=eq.${enc(email)}&password=eq.${enc(password)}&active=eq.true`),
};
const ROLES = {
  admin:   { label:"Admin",   color:"#00e5c3", canDelete:true,  canEdit:true  },
  manager: { label:"Manager", color:"#3b82f6", canDelete:false, canEdit:true  },
  staff:   { label:"Staff",   color:"#f97316", canDelete:false, canEdit:true  },
  viewer:  { label:"Viewer",  color:"#a78bfa", canDelete:false, canEdit:false },
};
const canDo = (user, perm) => user && ROLES[user.role]?.[perm];

const SESSION_KEY = "hzx_stock_user";
const saveSession = (u)=>{ try{ sessionStorage.setItem(SESSION_KEY, JSON.stringify(u)); }catch{} };
const loadSession = ()=>{ try{ const s=sessionStorage.getItem(SESSION_KEY); return s?JSON.parse(s):null; }catch{ return null; } };
const clearSession= ()=>{ try{ sessionStorage.removeItem(SESSION_KEY); }catch{} };

// ── stock_batches CRUD ────────────────────────────────────────────────────────
const stockDb = {
  fetchAll: ()      => sbFetch(`/stock_batches?order=date.desc,created_at.desc`),
  insert:   (f)     => sbFetch(`/stock_batches`,{method:"POST",body:JSON.stringify(f)}),
  patch:    (id,f)  => sbFetch(`/stock_batches?id=eq.${id}`,{method:"PATCH",body:JSON.stringify(f)}),
  remove:   (id)    => sbFetch(`/stock_batches?id=eq.${id}`,{method:"DELETE",headers:{...H,Prefer:""}}),
};

// ── daily_sales CRUD (one row per day, items = what was sold that day) ──────────
const dailyDb = {
  fetchAll: ()      => sbFetch(`/daily_sales?order=date.desc,created_at.desc`),
  insert:   (f)     => sbFetch(`/daily_sales`,{method:"POST",body:JSON.stringify(f)}),
  patch:    (id,f)  => sbFetch(`/daily_sales?id=eq.${id}`,{method:"PATCH",body:JSON.stringify(f)}),
  remove:   (id)    => sbFetch(`/daily_sales?id=eq.${id}`,{method:"DELETE",headers:{...H,Prefer:""}}),
};

// ── credit_entries CRUD (customer debt book: kind 'credit' given / 'payment' back)
const creditDb = {
  fetchAll: ()      => sbFetch(`/credit_entries?order=date.desc,created_at.desc`),
  insert:   (f)     => sbFetch(`/credit_entries`,{method:"POST",body:JSON.stringify(f)}),
  patch:    (id,f)  => sbFetch(`/credit_entries?id=eq.${id}`,{method:"PATCH",body:JSON.stringify(f)}),
  remove:   (id)    => sbFetch(`/credit_entries?id=eq.${id}`,{method:"DELETE",headers:{...H,Prefer:""}}),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const nv  = v => Number(v) || 0;
const fmt = v => nv(v).toLocaleString();
// match item/customer names case-insensitively and tolerant of extra spaces ("South  Beer" == "South Beer")
const normKey = s => String(s||"").trim().toLowerCase().replace(/\s+/g," ");
// tidy a name for display (collapses accidental double spaces) without lower-casing
const cleanName = s => String(s||"").trim().replace(/\s+/g," ");
const uid = () => Math.random().toString(36).slice(2,9);
const compact = v => { const a=Math.abs(v); return a>=1e6?`${(v/1e6).toFixed(a>=1e7?0:1)}M`:a>=1e3?`${Math.round(v/1e3)}K`:`${v}`; };
const itemCalc = (it) => {
  const totalCost   = nv(it.unitsBought) * nv(it.costPerUnit);
  const totalPieces = nv(it.unitsBought) * nv(it.piecesPerUnit);
  const expectedSales = totalPieces * nv(it.pricePerPiece);
  return { totalCost, totalPieces, expectedSales, profit: expectedSales - totalCost };
};
const batchCalc = (b) => {
  let spent=0, sales=0, pieces=0;
  (b.items||[]).forEach(it=>{ const c=itemCalc(it); spent+=c.totalCost; sales+=c.expectedSales; pieces+=c.totalPieces; });
  const profitOnStock = sales - spent;
  const expenses = nv(b.expenses);
  const capital = nv(b.capital);
  return { spent, sales, pieces, profitOnStock, expenses, capital,
    toSpend: spent + expenses,
    remaining: capital - spent - expenses,
    takeHome: profitOnStock - expenses,
    margin: sales>0 ? profitOnStock/sales : 0 };
};

// ── Daily sales: each item = {name, qtySold, sellPrice, costPrice} ──────────────
const saleItemCalc = (it) => {
  const qty=nv(it.qtySold), revenue=qty*nv(it.sellPrice), cost=qty*nv(it.costPrice);
  return { qty, revenue, cost, profit: revenue-cost };
};
const dailyCalc = (d) => {
  let revenue=0, cost=0, qty=0;
  (d.items||[]).forEach(it=>{ const c=saleItemCalc(it); revenue+=c.revenue; cost+=c.cost; qty+=c.qty; });
  const grossProfit=revenue-cost, expenses=nv(d.expenses);
  return { revenue, cost, qty, grossProfit, expenses, takeHome: grossProfit-expenses, margin: revenue>0 ? grossProfit/revenue : 0 };
};
// Known products derived from stock batches → powers the daily picker (remembers price & cost-per-piece).
// When a product appears in several batches, keep the prices from the most recent batch.
function productsFromBatches(batches){
  const map=new Map();
  (batches||[]).forEach(b=>{ const bdate=String(b.date||"");
    (b.items||[]).forEach(it=>{
      const name=(it.name||"").trim(); if(!name) return;
      const key=normKey(name); const prev=map.get(key);
      if(prev && String(prev._date)>=bdate) return;          // already have prices from a newer (or same) batch
      const pieces=nv(it.piecesPerUnit), costPiece=pieces>0 ? nv(it.costPerUnit)/pieces : 0;
      map.set(key,{ name:cleanName(name), sellPrice:nv(it.pricePerPiece), costPrice:Math.round(costPiece), _date:bdate });
    });
  });
  return [...map.values()].map(({_date,...p})=>p).sort((a,b)=>a.name.localeCompare(b.name));
}

// Live stock levels: pieces bought (from stock batches) minus pieces sold (in daily sales).
// "low" = less than one full carton (piecesPerUnit) left; "out" = nothing left.
function stockLevels(batches, dailies){
  const m=new Map();
  const get=name=>{ const key=normKey(name); let e=m.get(key); if(!e){ e={name, bought:0, sold:0, perUnit:0, _date:""}; m.set(key,e); } return e; };
  (batches||[]).forEach(b=>{ const bdate=String(b.date||"");
    (b.items||[]).forEach(it=>{ const name=(it.name||"").trim(); if(!name) return; const e=get(name);
      e.bought += nv(it.unitsBought)*nv(it.piecesPerUnit);
      if(bdate>=e._date){ e.perUnit=nv(it.piecesPerUnit); e._date=bdate; e.name=name; }
    });
  });
  (dailies||[]).forEach(d=>(d.items||[]).forEach(it=>{ const name=(it.name||"").trim(); if(!name) return; get(name).sold += nv(it.qtySold); }));
  const rows=[...m.values()].map(e=>{ const remaining=e.bought-e.sold;
    const status = remaining<=0 ? "out" : (e.perUnit>0 && remaining<e.perUnit) ? "low" : "ok";
    return { name:cleanName(e.name), bought:e.bought, sold:e.sold, remaining, perUnit:e.perUnit, status };
  });
  const rank={out:0,low:1,ok:2};
  return rows.sort((a,b)=> rank[a.status]-rank[b.status] || a.remaining-b.remaining || a.name.localeCompare(b.name));
}

// ── Credit book: roll the flat entry list up into one record per customer ───────
const creditSigned = (e) => (e.kind==="payment" ? -1 : 1) * nv(e.amount);  // +taken, -paid
function customersFromEntries(entries){
  const map=new Map();
  (entries||[]).forEach(e=>{
    const name=(e.customer||"").trim(); if(!name) return;
    const key=normKey(name);
    const c=map.get(key)||{name:cleanName(name), phone:"", taken:0, paid:0, outstanding:0, lastDate:"", count:0};
    if(e.kind==="payment") c.paid+=nv(e.amount); else c.taken+=nv(e.amount);
    c.outstanding=c.taken-c.paid; c.count++;
    if(e.phone && (!c.phone || String(e.date||"")>=String(c.phoneDate||""))){ c.phone=e.phone; c.phoneDate=e.date||""; }
    if(String(e.date||"")>String(c.lastDate||"")) c.lastDate=e.date||"";
    map.set(key,c);
  });
  return [...map.values()].sort((a,b)=>b.outstanding-a.outstanding || a.name.localeCompare(b.name));
}
const creditTotals = (entries) => {
  const custs=customersFromEntries(entries);
  return {
    given: custs.reduce((s,c)=>s+c.taken,0),
    repaid: custs.reduce((s,c)=>s+c.paid,0),
    outstanding: custs.reduce((s,c)=>s+Math.max(0,c.outstanding),0),
    owing: custs.filter(c=>c.outstanding>0.0001).length,
  };
};

// ── Palette ───────────────────────────────────────────────────────────────────
const DARK = {
  pageBg:"#0b1120", sidebar:"#0d1526", header:"#0d1526",
  card:"#111d33", cardB:"#1a2d4a", divider:"#162035",
  teal:"#00e5c3", tealBg:"rgba(0,229,195,0.08)",
  red:"#f05252", orange:"#f97316", yellow:"#fbbf24", green:"#10b981", blue:"#3b82f6",
  text:"#e2e8f0", muted:"#4b6080", subtle:"#1e3050", inputBg:"#090f1c",
};
const LIGHT = {
  pageBg:"#f0f4f8", sidebar:"#ffffff", header:"#ffffff",
  card:"#ffffff", cardB:"#d1dce8", divider:"#e2eaf3",
  teal:"#008a76", tealBg:"rgba(0,138,118,0.08)",
  red:"#dc2626", orange:"#ea580c", yellow:"#b45309", green:"#15803d", blue:"#1d4ed8",
  text:"#0f172a", muted:"#64748b", subtle:"#e2eaf3", inputBg:"#f8fafc",
};
const ThemeCtx = React.createContext(DARK);
const useTheme = () => React.useContext(ThemeCtx);

// ── Icons ─────────────────────────────────────────────────────────────────────
function Ico({d,size=18,color="currentColor"}){
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
}
const IC = {
  dashboard:"M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  add:"M12 5v14m-7-7h14",
  edit:"M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  trash:"M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  logout:"M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  check:"M5 13l4 4L19 7",
  back:"M19 12H5m7 7l-7-7 7-7",
  print:"M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z",
  wallet:"M21 12V7H5a2 2 0 010-4h14v4M3 5v14a2 2 0 002 2h16v-5M18 12a2 2 0 000 4h4v-4h-4z",
  beer:"M5 8h11v9a3 3 0 01-3 3H8a3 3 0 01-3-3V8zm11 1h2a2 2 0 012 2v2a2 2 0 01-2 2h-2M8 4v2m3-2v2m3-2v2",
  alert:"M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  cash:"M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  calendar:"M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  trophy:"M8 21h8m-4-4v4m5-17h2a2 2 0 010 4 4 4 0 01-2 2M7 4H5a2 2 0 000 4 4 4 0 002 2m0-8h10v5a5 5 0 01-10 0V4z",
  people:"M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zm14 14v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  box:"M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12l8.73-5.04M12 22.08V12",
};

// ── Shared UI ─────────────────────────────────────────────────────────────────
function mkINP(C){ return {width:"100%",background:C.inputBg,border:`1px solid ${C.cardB}`,borderRadius:8,
  color:C.text,padding:"11px 14px",fontSize:14,outline:"none",boxSizing:"border-box",
  fontVariantNumeric:"tabular-nums",transition:"border-color 0.15s"}; }

function Card({children,style={}}){ const C=useTheme(); return <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.cardB}`,...style}}>{children}</div>; }
function KPICard({label,value,suffix="SSP",color}){
  const C=useTheme(); const isMobile=useIsMobile(); const col=color||C.teal;
  return(
    <Card style={{padding:isMobile?"14px 16px":"22px 24px"}}>
      <div style={{fontSize:isMobile?11:13,color:C.muted,marginBottom:isMobile?8:16,fontWeight:500}}>{label}</div>
      <div style={{fontSize:isMobile?22:32,fontWeight:700,color:col,lineHeight:1,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>
        {typeof value==="number"?value.toLocaleString():value}
      </div>
      <div style={{fontSize:11,color:C.muted,marginTop:isMobile?4:8}}>{suffix}</div>
    </Card>
  );
}
function SLabel({children,style={}}){ const C=useTheme(); return <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,fontWeight:600,...style}}>{children}</div>; }
function Spinner(){ const C=useTheme(); return(<><style>{`@keyframes _spin{to{transform:rotate(360deg)}}`}</style>
  <div style={{width:32,height:32,border:`3px solid ${C.cardB}`,borderTop:`3px solid ${C.teal}`,borderRadius:"50%",animation:"_spin 0.8s linear infinite"}}/></>); }
function Loading(){ const C=useTheme(); return <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:60,gap:12,color:C.muted,fontSize:13}}><Spinner/> Loading…</div>; }
function useTT(){ const C=useTheme(); return {
  contentStyle:{background:C.card,border:`1px solid ${C.cardB}`,borderRadius:8,fontSize:11,color:C.text,padding:"8px 12px"},
  formatter:(v,n)=>[`SSP ${Number(v).toLocaleString()}`,n], labelStyle:{color:C.muted} }; }

class ErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state={err:null}; }
  static getDerivedStateFromError(e){ return {err:e}; }
  render(){
    if(this.state.err){ const C=this.props.theme||DARK;
      return(<div style={{padding:24,textAlign:"center",color:C.muted,fontSize:13}}>
        <div style={{fontSize:22,marginBottom:8}}>⚠</div>
        <div style={{color:C.red,marginBottom:4,fontWeight:600}}>Something went wrong</div>
        <div style={{fontSize:11,marginBottom:16}}>{this.state.err.message}</div>
        <button onClick={()=>this.setState({err:null})} style={{background:C.teal,border:"none",borderRadius:7,color:"#09111e",padding:"7px 16px",fontWeight:700,fontSize:12,cursor:"pointer"}}>Try Again</button>
      </div>);
    }
    return this.props.children;
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({batches, user, onEdit, onDelete, onNew, onPrint}){
  const C=useTheme(); const TT=useTT();
  const isMobile=useIsMobile(); const isTablet=useIsTablet();

  const totals = batches.reduce((a,b)=>{ const t=batchCalc(b);
    a.spent+=t.spent; a.sales+=t.sales; a.profit+=t.profitOnStock; a.expenses+=t.expenses; a.takeHome+=t.takeHome; return a;
  },{spent:0,sales:0,profit:0,expenses:0,takeHome:0});
  const margin = totals.sales>0 ? (totals.profit/totals.sales*100).toFixed(1) : "0.0";
  const chartData = [...batches].reverse().map(b=>{ const t=batchCalc(b);
    return { name: b.name.length>12?b.name.slice(0,11)+"…":b.name, Cost:t.spent, Sales:t.sales }; });

  if(batches.length===0){
    return(
      <div style={{textAlign:"center",maxWidth:420,margin:"60px auto",padding:"0 20px"}}>
        <div style={{width:60,height:60,borderRadius:16,background:C.tealBg,border:`1px solid ${C.teal}44`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px"}}>
          <Ico d={IC.beer} size={26} color={C.teal}/>
        </div>
        <div style={{fontSize:18,fontWeight:700,color:C.text}}>No stock recorded yet</div>
        <div style={{fontSize:13,color:C.muted,marginTop:6,lineHeight:1.6}}>Add a batch of stock you bought and the dashboard works out your costs, sales and profit.</div>
        {canDo(user,"canEdit")&&(
          <button onClick={onNew} style={{marginTop:18,background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"11px 20px",fontWeight:700,fontSize:13,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8}}>
            <Ico d={IC.add} size={16} color="#09111e"/> Add your first stock
          </button>
        )}
      </div>
    );
  }

  return(
    <div>
      {/* KPI row */}
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":isTablet?"repeat(2,1fr)":"repeat(4,1fr)",gap:isMobile?10:14,marginBottom:16}}>
        <KPICard label="Money Spent on Stock" value={totals.spent}  color={C.orange}/>
        <KPICard label="Expected Sales"        value={totals.sales}  color={C.blue}/>
        <KPICard label="Profit on Stock"       value={totals.profit} color={C.teal}/>
        <KPICard label="Take-Home Profit"      value={totals.takeHome} color={totals.takeHome>=0?C.green:C.red}/>
      </div>

      {/* strip */}
      <Card style={{padding:isMobile?"12px 14px":"14px 22px",marginBottom:16,display:"flex",alignItems:"center",gap:isMobile?12:24,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Profit Margin</div>
          <div style={{color:C.teal,fontWeight:700,fontSize:18}}>{margin}%</div>
          <div style={{fontSize:10,color:C.muted,marginTop:2}}>of expected sales is profit</div>
        </div>
        <div style={{width:1,height:40,background:C.cardB}}/>
        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Other Expenses</div>
          <div style={{color:C.red,fontWeight:700,fontSize:18,fontVariantNumeric:"tabular-nums"}}>SSP {totals.expenses.toLocaleString()}</div>
          <div style={{fontSize:10,color:C.muted,marginTop:2}}>rent, transport, staff…</div>
        </div>
        <div style={{width:1,height:40,background:C.cardB}}/>
        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Stock Batches</div>
          <div style={{color:C.yellow,fontWeight:700,fontSize:18,fontVariantNumeric:"tabular-nums"}}>{batches.length}</div>
          <div style={{fontSize:10,color:C.muted,marginTop:2}}>recorded so far</div>
        </div>
      </Card>

      {/* chart */}
      <Card style={{padding:isMobile?16:22,marginBottom:16}}>
        <SLabel style={{marginBottom:16}}>Cost vs. Expected Sales (per batch)</SLabel>
        <ResponsiveContainer width="100%" height={isMobile?220:260}>
          <BarChart data={chartData} margin={{top:4,right:4,left:-10,bottom:isMobile?28:8}} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.subtle} vertical={false}/>
            <XAxis dataKey="name" tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false}
              angle={isMobile?-25:0} textAnchor={isMobile?"end":"middle"} interval={0} height={isMobile?44:24}/>
            <YAxis tick={{fill:C.muted,fontSize:9}} axisLine={false} tickLine={false} width={40} tickFormatter={compact}/>
            <Tooltip {...TT} cursor={{fill:C.tealBg}}/>
            <Bar dataKey="Cost"  fill={C.orange} radius={[3,3,0,0]} maxBarSize={26}/>
            <Bar dataKey="Sales" fill={C.teal}   radius={[3,3,0,0]} maxBarSize={26}/>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* batch list — spreadsheet-style table (scrolls sideways on small phones) */}
      <SLabel style={{marginBottom:12}}>Stock Batches</SLabel>
      <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",border:`1px solid ${C.cardB}`,borderRadius:12,background:C.card}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:760}}>
          <thead>
            <tr style={{background:C.inputBg}}>
              {[["Stock",0],["Date",0],["Items",1],["Spent",1],["Exp. sales",1],["Take-home",1],["Margin",1],["",0]].map(([h,r],i)=>(
                <th key={i} style={{textAlign:r?"right":"left",fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",color:C.muted,fontWeight:600,padding:"11px 14px",borderBottom:`1px solid ${C.cardB}`,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map(b=>{
              const t=batchCalc(b);
              const dateStr=b.date?new Date(b.date+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"No date";
              const tdN={padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,textAlign:"right",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap",fontWeight:600,fontSize:13};
              return(
                <tr key={b.id}>
                  <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,fontWeight:700,color:C.text,fontSize:13,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.name}</td>
                  <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,color:C.muted,fontSize:12,whiteSpace:"nowrap"}}>{dateStr}</td>
                  <td style={{...tdN,color:C.muted,fontWeight:400}}>{b.items.length}</td>
                  <td style={{...tdN,color:C.orange}}>{fmt(t.spent)}</td>
                  <td style={{...tdN,color:C.blue}}>{fmt(t.sales)}</td>
                  <td style={{...tdN,color:t.takeHome>=0?C.green:C.red}}>{t.takeHome>=0?"+":""}{fmt(t.takeHome)}</td>
                  <td style={{...tdN,color:C.teal}}>{(t.margin*100).toFixed(1)}%</td>
                  <td style={{padding:"10px 10px",borderBottom:`1px solid ${C.divider}`,textAlign:"right",whiteSpace:"nowrap"}}>
                    <div style={{display:"inline-flex",gap:6}}>
                      <button onClick={()=>onPrint(b)} title="Print report" style={{background:C.inputBg,border:`1px solid ${C.cardB}`,borderRadius:6,padding:6,cursor:"pointer",display:"flex"}}>
                        <Ico d={IC.print} size={14} color={C.muted}/>
                      </button>
                      {canDo(user,"canEdit")&&(
                        <button onClick={()=>onEdit(b)} title="Edit" style={{background:C.tealBg,border:`1px solid ${C.teal}44`,borderRadius:6,padding:6,cursor:"pointer",display:"flex"}}>
                          <Ico d={IC.edit} size={14} color={C.teal}/>
                        </button>
                      )}
                      {canDo(user,"canDelete")&&(
                        <button onClick={()=>onDelete(b)} title="Delete" style={{background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:6,padding:6,cursor:"pointer",display:"flex"}}>
                          <Ico d={IC.trash} size={14} color={C.red}/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(()=>{ const tf={padding:"11px 14px",textAlign:"right",fontWeight:700,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"};
              return(
                <tr style={{background:C.inputBg}}>
                  <td style={{padding:"11px 14px",fontWeight:700,color:C.text,fontSize:12}}>{batches.length} batch{batches.length===1?"":"es"}</td>
                  <td/>
                  <td/>
                  <td style={{...tf,color:C.orange}}>{fmt(totals.spent)}</td>
                  <td style={{...tf,color:C.blue}}>{fmt(totals.sales)}</td>
                  <td style={{...tf,color:totals.takeHome>=0?C.green:C.red}}>{totals.takeHome>=0?"+":""}{fmt(totals.takeHome)}</td>
                  <td style={{...tf,color:C.teal}}>{margin}%</td>
                  <td/>
                </tr>
              );
            })()}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── STOCK ENTRY ───────────────────────────────────────────────────────────────
const blankItem = () => ({ id:uid(), name:"", unitsBought:"", costPerUnit:"", piecesPerUnit:"", pricePerPiece:"" });
const toDraft = (b) => b
  ? { id:b.id, name:b.name, date:b.date||"", capital:String(b.capital??""), expenses:String(b.expenses??""),
      items:(b.items||[]).map(it=>({ id:it.id||uid(), name:it.name,
        unitsBought:String(it.unitsBought??""), costPerUnit:String(it.costPerUnit??""),
        piecesPerUnit:String(it.piecesPerUnit??""), pricePerPiece:String(it.pricePerPiece??"") })) }
  : { id:null, name:"", date:todayStr(), capital:"", expenses:"", items:[blankItem()] };
// turn the in-progress form into a batch-shaped object (numbers) for printing
const draftToBatch = (d) => ({
  name: d.name.trim() || d.date || "Stock plan", date: d.date || null,
  capital: nv(d.capital), expenses: nv(d.expenses),
  items: d.items.filter(it=>it.name.trim()!=="").map(it=>({
    id:it.id, name:it.name.trim(), unitsBought:nv(it.unitsBought), costPerUnit:nv(it.costPerUnit),
    piecesPerUnit:nv(it.piecesPerUnit), pricePerPiece:nv(it.pricePerPiece) })),
});

function StockEntry({initial, onSaved, onCancel, onPrint}){
  const C=useTheme(); const isMobile=useIsMobile();
  const [draft,setDraft]=useState(()=>toDraft(initial));
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const isEdit=Boolean(initial);

  const setField=(k,v)=>setDraft(d=>({...d,[k]:v}));
  const setItem=(id,k,v)=>setDraft(d=>({...d,items:d.items.map(it=>it.id===id?{...it,[k]:v}:it)}));
  const addItem=()=>setDraft(d=>({...d,items:[...d.items,blankItem()]}));
  const removeItem=(id)=>setDraft(d=>({...d,items:d.items.filter(it=>it.id!==id)}));

  const totals=batchCalc(draft);

  async function save(){
    const items=draft.items.filter(it=>it.name.trim()!=="").map(it=>({
      id:it.id, name:it.name.trim(), unitsBought:nv(it.unitsBought), costPerUnit:nv(it.costPerUnit),
      piecesPerUnit:nv(it.piecesPerUnit), pricePerPiece:nv(it.pricePerPiece) }));
    if(!draft.name.trim() && !draft.date){ setError("Give this stock a name or pick a date."); return; }
    if(items.length===0){ setError("Add at least one item with a name."); return; }
    setError(""); setBusy(true);
    const payload={ name:draft.name.trim()||draft.date, date:draft.date||null, capital:nv(draft.capital), expenses:nv(draft.expenses), items };
    try{
      const rows = isEdit ? await stockDb.patch(draft.id,payload) : await stockDb.insert(payload);
      onSaved(rows && rows[0] ? rows[0] : { ...payload, id:draft.id||uid() });
    }catch(e){
      console.error(e);
      const msg=String(e&&e.message||"");
      let nice="Could not save — check your connection and try again.";
      if(/capital/i.test(msg))                              nice='Database is missing the "capital" column. In Supabase run: alter table public.stock_batches add column if not exists capital numeric not null default 0;';
      else if(/stock_batches/i.test(msg)&&/(exist|relation|schema cache)/i.test(msg)) nice="The stock_batches table isn't set up. Run schema.sql in your Supabase SQL editor.";
      else if(/row-level security|policy/i.test(msg))       nice="Supabase blocked the save (row-level security). Run the policy section of schema.sql.";
      else if(/jwt|expired|invalid.*key|401|apikey/i.test(msg)) nice="Supabase key problem. Check the anon key/URL in App.jsx.";
      else if(msg)                                          nice="Could not save: "+msg.replace(/\s+/g," ").slice(0,180);
      setError(nice); setBusy(false);
    }
  }

  const lbl={fontSize:11,color:C.muted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"};
  const focus=e=>e.target.style.borderColor=C.teal, blur=e=>e.target.style.borderColor=C.cardB;
  const cellINP={width:"100%",background:C.inputBg,border:`1px solid ${C.cardB}`,borderRadius:6,color:C.text,padding:"8px 9px",fontSize:13,outline:"none",boxSizing:"border-box",fontVariantNumeric:"tabular-nums",transition:"border-color 0.15s"};

  return(
    <div style={{paddingBottom:90}}>
      <button onClick={onCancel} style={{display:"inline-flex",alignItems:"center",gap:6,background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:13,marginBottom:14}}>
        <Ico d={IC.back} size={15} color={C.muted}/> Back to dashboard
      </button>

      {/* capital + batch details */}
      <Card style={{padding:isMobile?16:22,marginBottom:16}}>
        <SLabel style={{marginBottom:14}}>{isEdit?"Edit stock":"New stock"}</SLabel>

        {/* Available capital — money you're taking to the market */}
        <div style={{background:C.tealBg,border:`1px solid ${C.teal}33`,borderRadius:10,padding:isMobile?"12px 14px":"14px 16px",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <Ico d={IC.wallet} size={16} color={C.teal}/>
            <label style={{...lbl,margin:0,color:C.teal}}>Available capital before buying (SSP)</label>
          </div>
          <input type="number" value={draft.capital} placeholder="e.g. 2,000,000"
            style={{...mkINP(C),fontSize:18,fontWeight:700}} onFocus={focus} onBlur={blur}
            onChange={e=>setField("capital",e.target.value)}/>
          {nv(draft.capital)>0 && (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginTop:10,fontSize:12}}>
              <span style={{color:C.muted}}>Buying {fmt(totals.spent)}{totals.expenses>0?` + expenses ${fmt(totals.expenses)}`:""}</span>
              <span style={{fontWeight:700,color:totals.remaining>=0?C.green:C.red}}>
                {totals.remaining>=0?`Cash left: ${fmt(totals.remaining)} SSP`:`Over budget by ${fmt(-totals.remaining)} SSP`}
              </span>
            </div>
          )}
        </div>

        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:12}}>
          <div><label style={lbl}>Stock name</label>
            <input value={draft.name} placeholder="e.g. Week of 9 June" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("name",e.target.value)}/></div>
          <div><label style={lbl}>Date bought</label>
            <input type="date" value={draft.date} style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("date",e.target.value)}/></div>
          <div><label style={lbl}>Other expenses (SSP)</label>
            <input type="number" value={draft.expenses} placeholder="0" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("expenses",e.target.value)}/></div>
        </div>
      </Card>

      {/* items */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <SLabel>Items bought</SLabel>
        <span style={{fontSize:12,color:C.muted}}>{draft.items.length} row{draft.items.length===1?"":"s"}</span>
      </div>

      {isMobile ? (
        /* phones: stacked cards (a table is too wide for a small screen) */
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {draft.items.map((it,idx)=>{
            const c=itemCalc(it);
            return(
              <Card key={it.id} style={{padding:16}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                  <span style={{width:24,height:24,borderRadius:6,background:C.tealBg,color:C.teal,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{idx+1}</span>
                  <input value={it.name} placeholder="Item (e.g. Tusker)" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setItem(it.id,"name",e.target.value)}/>
                  <button onClick={()=>removeItem(it.id)} title="Remove" style={{background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:6,padding:8,cursor:"pointer",display:"flex",flexShrink:0}}>
                    <Ico d={IC.trash} size={15} color={C.red}/>
                  </button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {[["Units bought","unitsBought"],["Cost per unit","costPerUnit"],["Pieces per unit","piecesPerUnit"],["Sell price / piece","pricePerPiece"]].map(([label,key])=>(
                    <div key={key}><label style={lbl}>{label}</label>
                      <input type="number" inputMode="decimal" value={it[key]} placeholder="0" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setItem(it.id,key,e.target.value)}/></div>
                  ))}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
                  {[["Total cost",c.totalCost,C.text],["Total pieces",c.totalPieces,C.text],["Expected sales",c.expectedSales,C.blue],["Profit",c.profit,c.profit>=0?C.green:C.red]].map(([label,val,col])=>(
                    <div key={label} style={{background:C.inputBg,borderRadius:8,padding:"8px 10px"}}>
                      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
                      <div style={{fontSize:13,fontWeight:600,color:col,fontVariantNumeric:"tabular-nums"}}>{fmt(val)}</div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        /* tablet & desktop: spreadsheet-style table */
        <div style={{overflowX:"auto",border:`1px solid ${C.cardB}`,borderRadius:12,background:C.card}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:880}}>
            <thead>
              <tr style={{background:C.inputBg}}>
                {[["#",0],["Item",0],["Units",1],["Cost / unit",1],["Pieces / unit",1],["Price / piece",1],["Total cost",1],["Exp. sales",1],["Profit",1],["",0]].map(([h,r],i)=>(
                  <th key={i} style={{textAlign:r?"right":"left",fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",color:C.muted,fontWeight:600,padding:"11px 12px",borderBottom:`1px solid ${C.cardB}`,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draft.items.map((it,idx)=>{
                const c=itemCalc(it);
                const tdN={padding:"5px 8px",borderBottom:`1px solid ${C.divider}`,textAlign:"right",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap",fontWeight:600,fontSize:13};
                return(
                  <tr key={it.id}>
                    <td style={{padding:"5px 12px",borderBottom:`1px solid ${C.divider}`,color:C.muted,fontSize:12}}>{idx+1}</td>
                    <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.divider}`}}>
                      <input value={it.name} placeholder="e.g. Tusker" style={{...cellINP,minWidth:130}} onFocus={focus} onBlur={blur} onChange={e=>setItem(it.id,"name",e.target.value)}/>
                    </td>
                    {["unitsBought","costPerUnit","piecesPerUnit","pricePerPiece"].map(k=>(
                      <td key={k} style={{padding:"5px 8px",borderBottom:`1px solid ${C.divider}`}}>
                        <input type="number" inputMode="decimal" value={it[k]} placeholder="0" style={{...cellINP,textAlign:"right",minWidth:84}} onFocus={focus} onBlur={blur} onChange={e=>setItem(it.id,k,e.target.value)}/>
                      </td>
                    ))}
                    <td style={{...tdN,color:C.text}}>{fmt(c.totalCost)}</td>
                    <td style={{...tdN,color:C.blue}}>{fmt(c.expectedSales)}</td>
                    <td style={{...tdN,color:c.profit>=0?C.green:C.red}}>{fmt(c.profit)}</td>
                    <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.divider}`,textAlign:"center"}}>
                      <button onClick={()=>removeItem(it.id)} title="Remove" style={{background:"transparent",border:"none",cursor:"pointer",padding:4,display:"flex"}}>
                        <Ico d={IC.trash} size={15} color={C.red}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{background:C.inputBg}}>
                <td/>
                <td style={{padding:"10px 8px",fontWeight:700,color:C.text,fontSize:12}}>Totals</td>
                <td colSpan={4}/>
                <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{fmt(totals.spent)}</td>
                <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:C.blue,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{fmt(totals.sales)}</td>
                <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:totals.profitOnStock>=0?C.green:C.red,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{fmt(totals.profitOnStock)}</td>
                <td/>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <button onClick={addItem} style={{marginTop:12,width:"100%",background:C.tealBg,border:`1px dashed ${C.teal}66`,borderRadius:10,color:C.teal,padding:"12px",fontWeight:600,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <Ico d={IC.add} size={16} color={C.teal}/> Add another item
      </button>

      {error&&(
        <div style={{marginTop:14,padding:"10px 14px",background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:8,fontSize:12,color:C.red,display:"flex",alignItems:"center",gap:8}}>
          <Ico d={IC.alert} size={15} color={C.red}/> {error}
        </div>
      )}

      {/* sticky save bar */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.header,borderTop:`1px solid ${C.cardB}`,zIndex:20}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:isMobile?"10px 14px":"12px 28px",display:"flex",alignItems:"center",gap:16}}>
          {!isMobile&&(
            <div style={{display:"flex",gap:24,flex:1}}>
              <div><div style={{fontSize:10,color:C.muted}}>Spent</div><div style={{fontSize:15,fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(totals.spent)}</div></div>
              <div><div style={{fontSize:10,color:C.muted}}>Expected sales</div><div style={{fontSize:15,fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(totals.sales)}</div></div>
              <div><div style={{fontSize:10,color:C.muted}}>Take-home</div><div style={{fontSize:15,fontWeight:700,color:totals.takeHome>=0?C.green:C.red,fontVariantNumeric:"tabular-nums"}}>{totals.takeHome>=0?"+":""}{fmt(totals.takeHome)}</div></div>
            </div>
          )}
          {isMobile&&<div style={{flex:1}}><div style={{fontSize:10,color:C.muted}}>Take-home</div><div style={{fontSize:16,fontWeight:700,color:totals.takeHome>=0?C.green:C.red}}>{totals.takeHome>=0?"+":""}{fmt(totals.takeHome)} SSP</div></div>}
          <button onClick={()=>onPrint(draftToBatch(draft))} disabled={busy} title="Print shopping list to carry to the market"
            style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:13,cursor:"pointer",opacity:busy?0.5:1,display:"flex",alignItems:"center",gap:7}}>
            <Ico d={IC.print} size={16} color={C.text}/>{!isMobile&&" Print plan"}
          </button>
          {!isMobile&&<button onClick={onCancel} disabled={busy} style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"10px 16px",fontSize:13,cursor:"pointer",opacity:busy?0.5:1}}>Cancel</button>}
          <button onClick={save} disabled={busy} style={{background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"10px 20px",fontWeight:700,fontSize:13,cursor:busy?"not-allowed":"pointer",opacity:busy?0.7:1,display:"flex",alignItems:"center",gap:8}}>
            <Ico d={IC.check} size={16} color="#09111e"/> {busy?"Saving…":isEdit?"Save changes":"Save stock"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm delete ────────────────────────────────────────────────────────────
function ConfirmDelete({target,onCancel,onConfirm}){
  const C=useTheme();
  const {kind,row}=target;
  const titles={stock:"Delete this stock?",daily:"Delete this day's sales?",credit:"Delete this entry?",customer:"Remove this customer?"};
  let label, desc;
  if(kind==="daily"){ label=niceDate(row.date); const n=(row.items||[]).length; desc=<><strong style={{color:C.text}}>{label}</strong> and its {n} item{n===1?"":"s"} will be removed. This can't be undone.</>; }
  else if(kind==="credit"){ const isPay=row.kind==="payment"; label=`${isPay?"Payment":"Credit"} · ${row.customer}`; desc=<>This {isPay?"payment":"credit"} of <strong style={{color:C.text}}>SSP {fmt(row.amount)}</strong> for {row.customer} on {niceDate(row.date)} will be removed. This can't be undone.</>; }
  else if(kind==="customer"){ label=row.name; desc=<>All <strong style={{color:C.text}}>{row.count}</strong> entr{row.count===1?"y":"ies"} for <strong style={{color:C.text}}>{row.name}</strong> will be removed{row.outstanding>0?<> (clearing the <strong style={{color:C.text}}>SSP {fmt(row.outstanding)}</strong> they owe)</>:""}. This can't be undone.</>; }
  else { label=row.name; const n=(row.items||[]).length; desc=<><strong style={{color:C.text}}>{label}</strong> and its {n} item{n===1?"":"s"} will be removed. This can't be undone.</>; }
  return(
    <div onClick={onCancel} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.cardB}`,borderRadius:12,padding:24,maxWidth:380,width:"100%"}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text}}>{titles[kind]||"Delete this?"}</div>
        <div style={{fontSize:13,color:C.muted,marginTop:8,lineHeight:1.6}}>
          {desc}
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20}}>
          <button onClick={onCancel} style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"9px 16px",fontSize:13,cursor:"pointer"}}>Keep it</button>
          <button onClick={onConfirm} style={{background:C.red,border:"none",borderRadius:8,color:"#fff",padding:"9px 16px",fontWeight:700,fontSize:13,cursor:"pointer"}}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── PRINTABLE REPORTS ─────────────────────────────────────────────────────────
// A clean white frame. On screen it floats over the app; when printed, only the
// report area shows (the print CSS hides everything else).
const RP = { ink:"#111827", soft:"#6b7280", line:"#d1d5db", lite:"#f3f4f6", teal:"#0e7c6b", red:"#b91c1c", green:"#15803d" };
const money = v => `SSP ${nv(v).toLocaleString()}`;
const dmy = d => d ? new Date(d+"T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";

function PrintFrame({onClose, children}){
  const C=useTheme();
  return(
    <div className="hzx-print-overlay" style={{position:"fixed",inset:0,background:"#586577",zIndex:100,overflowY:"auto"}}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .hzx-print-area, .hzx-print-area * { visibility: visible !important; }
          .hzx-print-area { position:absolute !important; left:0; top:0; width:100%; box-shadow:none !important; margin:0 !important; }
          .hzx-no-print { display:none !important; }
          @page { margin: 14mm; }
        }
      `}</style>
      <div className="hzx-no-print" style={{position:"sticky",top:0,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"12px 16px",background:C.header,borderBottom:`1px solid ${C.cardB}`}}>
        <span style={{color:C.text,fontSize:13,fontWeight:600}}>Print preview</span>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"9px 16px",fontSize:13,cursor:"pointer"}}>Close</button>
          <button onClick={()=>window.print()} style={{background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"9px 18px",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
            <Ico d={IC.print} size={16} color="#09111e"/> Print / Save PDF
          </button>
        </div>
      </div>
      <div className="hzx-print-area" style={{maxWidth:780,margin:"18px auto",background:"#fff",color:RP.ink,
        padding:"34px 38px",borderRadius:4,boxShadow:"0 10px 40px rgba(0,0,0,0.3)",
        fontFamily:"'Inter',system-ui,sans-serif",fontSize:13,lineHeight:1.5}}>
        {children}
      </div>
      <div style={{height:30}}/>
    </div>
  );
}

function ReportHeader({title}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",borderBottom:`2px solid ${RP.ink}`,paddingBottom:14,marginBottom:18}}>
      <div>
        <div style={{fontSize:20,fontWeight:800,letterSpacing:"-0.01em"}}>HOTZONEX REFRESHMENT CENTRE</div>
        <div style={{fontSize:12,color:RP.soft,marginTop:2}}>Juba, South Sudan · all amounts in SSP</div>
        <div style={{fontSize:15,fontWeight:700,color:RP.teal,marginTop:10}}>{title}</div>
      </div>
      <div style={{textAlign:"right",fontSize:11,color:RP.soft}}>
        <div>Printed</div>
        <div style={{fontWeight:700,color:RP.ink}}>{new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}</div>
        <div style={{marginTop:4}}>{new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</div>
      </div>
    </div>
  );
}

const Trow = ({cells, head, strong, right=[]}) => (
  <tr>{cells.map((c,i)=>(
    <td key={i} style={{padding:"7px 8px",borderBottom:`1px solid ${RP.line}`,
      textAlign:right.includes(i)?"right":"left",fontWeight:head||strong?700:400,
      background:head?RP.lite:"transparent",fontVariantNumeric:"tabular-nums",
      whiteSpace:right.includes(i)?"nowrap":"normal"}}>{c}</td>
  ))}</tr>
);

// One batch → a market shopping plan + the expected result
function BatchReport({batch}){
  const t=batchCalc(batch);
  return(
    <>
      <ReportHeader title="Stock Purchase Plan"/>
      <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:16}}>
        <div><div style={{fontSize:11,color:RP.soft}}>Stock</div><div style={{fontWeight:700,fontSize:15}}>{batch.name}</div></div>
        <div><div style={{fontSize:11,color:RP.soft}}>Date</div><div style={{fontWeight:700}}>{dmy(batch.date)}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:11,color:RP.soft}}>Available capital</div><div style={{fontWeight:800,fontSize:16,color:RP.teal}}>{money(t.capital)}</div></div>
      </div>

      <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",marginBottom:6,minWidth:520}}>
        <thead><Trow head cells={["#","Item","Units","Cost / unit","Total cost","Actual paid"]} right={[2,3,4,5]}/></thead>
        <tbody>
          {batch.items.map((it,i)=>{ const c=itemCalc(it);
            return <Trow key={i} cells={[i+1, it.name, fmt(it.unitsBought), fmt(it.costPerUnit), fmt(c.totalCost), "__________"]} right={[2,3,4,5]}/>;
          })}
          <Trow strong cells={["", "TOTAL STOCK COST", "", "", money(t.spent), ""]} right={[2,3,4,5]}/>
        </tbody>
      </table>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:24,marginTop:18}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:RP.soft,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Money at the market</div>
          {[["Stock cost",money(t.spent)],["Other expenses",money(t.expenses)],["Total to spend",money(t.toSpend)],["Available capital",money(t.capital)]].map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${RP.line}`}}><span style={{color:RP.soft}}>{k}</span><span style={{fontWeight:600}}>{v}</span></div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",marginTop:2}}>
            <span style={{fontWeight:800}}>{t.remaining>=0?"Cash left over":"OVER BUDGET BY"}</span>
            <span style={{fontWeight:800,color:t.remaining>=0?RP.green:RP.red}}>{money(Math.abs(t.remaining))}</span>
          </div>
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:RP.soft,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Expected after selling</div>
          {[["Total pieces",fmt(t.pieces)],["Expected sales",money(t.sales)],["Profit on stock",money(t.profitOnStock)],["Profit margin",`${(t.margin*100).toFixed(1)}%`]].map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${RP.line}`}}><span style={{color:RP.soft}}>{k}</span><span style={{fontWeight:600}}>{v}</span></div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",marginTop:2}}>
            <span style={{fontWeight:800}}>Take-home profit</span>
            <span style={{fontWeight:800,color:t.takeHome>=0?RP.green:RP.red}}>{money(t.takeHome)}</span>
          </div>
        </div>
      </div>

      <div style={{marginTop:28,paddingTop:12,borderTop:`1px solid ${RP.line}`,display:"flex",justifyContent:"space-between",fontSize:11,color:RP.soft}}>
        <span>Bought by: ____________________</span>
        <span>Signature: ____________________</span>
      </div>
    </>
  );
}

// All batches → a business summary
function SummaryReport({batches}){
  const g=batches.reduce((a,b)=>{ const t=batchCalc(b);
    a.spent+=t.spent; a.sales+=t.sales; a.profit+=t.profitOnStock; a.expenses+=t.expenses; a.takeHome+=t.takeHome; return a;
  },{spent:0,sales:0,profit:0,expenses:0,takeHome:0});
  return(
    <>
      <ReportHeader title="Stock Summary Report"/>
      <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:520}}>
        <thead><Trow head cells={["Stock","Date","Spent","Expected sales","Take-home","Margin"]} right={[2,3,4,5]}/></thead>
        <tbody>
          {batches.map((b,i)=>{ const t=batchCalc(b);
            return <Trow key={i} cells={[b.name, dmy(b.date), fmt(t.spent), fmt(t.sales), `${t.takeHome>=0?"+":""}${fmt(t.takeHome)}`, `${(t.margin*100).toFixed(1)}%`]} right={[2,3,4,5]}/>;
          })}
          <Trow strong cells={["TOTAL", `${batches.length} batches`, fmt(g.spent), fmt(g.sales), `${g.takeHome>=0?"+":""}${fmt(g.takeHome)}`, g.sales>0?`${(g.profit/g.sales*100).toFixed(1)}%`:"0.0%"]} right={[2,3,4,5]}/>
        </tbody>
      </table>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:16,marginTop:22}}>
        {[["Money spent",money(g.spent)],["Expected sales",money(g.sales)],["Other expenses",money(g.expenses)],["Take-home profit",money(g.takeHome)]].map(([k,v])=>(
          <div key={k}><div style={{fontSize:11,color:RP.soft}}>{k}</div><div style={{fontWeight:800,fontSize:15}}>{v}</div></div>
        ))}
      </div>
    </>
  );
}

// Reports tab — pick what to print
function ReportsView({batches, onPrintBatch, onPrintSummary}){
  const C=useTheme(); const isMobile=useIsMobile();
  if(batches.length===0) return <div style={{color:C.muted,padding:40,textAlign:"center",fontSize:13}}>No stock yet — add some, then you can print reports.</div>;
  return(
    <div>
      <Card style={{padding:18,marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:C.text}}>Full stock summary</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>All {batches.length} batches, totals and margins — one page.</div>
        </div>
        <button onClick={onPrintSummary} style={{background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"10px 18px",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
          <Ico d={IC.print} size={16} color="#09111e"/> Print summary
        </button>
      </Card>
      <SLabel style={{marginBottom:12}}>Print a single purchase plan</SLabel>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}}>
        {batches.map(b=>{ const t=batchCalc(b);
          return(
            <Card key={b.id} style={{padding:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:14,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{dmy(b.date)} · spent {fmt(t.spent)}</div>
              </div>
              <button onClick={()=>onPrintBatch(b)} title="Print plan" style={{flexShrink:0,background:C.inputBg,border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"9px 14px",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:7}}>
                <Ico d={IC.print} size={15} color={C.muted}/> Print
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── DAILY SALES DASHBOARD ─────────────────────────────────────────────────────
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const niceDate = (s) => s ? new Date(s+"T00:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"}) : "No date";

// ── Shared list controls: segmented filter tabs + status badge ─────────────────
function SegTabs({tabs, value, onChange}){
  const C=useTheme();
  return(
    <div style={{display:"inline-flex",background:C.inputBg,border:`1px solid ${C.cardB}`,borderRadius:9,padding:3,gap:2,flexWrap:"wrap"}}>
      {tabs.map(t=>{ const active=t.id===value; return(
        <button key={t.id} onClick={()=>onChange(t.id)} style={{border:"none",background:active?C.teal:"transparent",color:active?"#09111e":C.muted,fontWeight:active?700:500,fontSize:12,padding:"6px 12px",borderRadius:7,cursor:"pointer",whiteSpace:"nowrap"}}>
          {t.label}{t.count!=null?` · ${t.count}`:""}
        </button>); })}
    </div>
  );
}
function StatusBadge({outstanding}){
  const C=useTheme();
  const s = outstanding>0.0001 ? {l:"Open",c:C.orange} : outstanding<-0.0001 ? {l:"Overpaid",c:C.blue} : {l:"Settled",c:C.green};
  return <span style={{fontSize:10,fontWeight:700,padding:"2px 9px",borderRadius:20,background:`${s.c}22`,color:s.c,whiteSpace:"nowrap"}}>{s.l}</span>;
}
const custStatusKey = c => c.outstanding>0.0001 ? "open" : "settled";

// ── OVERVIEW (professional dashboard / home) ───────────────────────────────────
function Overview({batches, dailies, credits, user, onGoto, onGiveCredit, onOpenCustomer}){
  const C=useTheme(); const TT=useTT(); const isMobile=useIsMobile(); const isTablet=useIsTablet();
  const today=todayStr(); const ym=today.slice(0,7);

  const creditByDay=new Map();
  (credits||[]).forEach(e=>{ if(e.daily_id && e.kind!=="payment") creditByDay.set(e.daily_id,(creditByDay.get(e.daily_id)||0)+nv(e.amount)); });
  const creditOf=d=>creditByDay.get(d.id)||0;
  const sumRows=rows=>rows.reduce((a,d)=>{ const t=dailyCalc(d), cr=creditOf(d); a.sales+=t.revenue; a.profit+=t.takeHome; a.credit+=cr; a.cash+=t.revenue-cr; return a; },{sales:0,profit:0,credit:0,cash:0});
  const todayT=sumRows((dailies||[]).filter(d=>d.date===today));
  const monthT=sumRows((dailies||[]).filter(d=>String(d.date||"").startsWith(ym)));

  const ctot=creditTotals(credits||[]);
  const custs=customersFromEntries(credits||[]);
  const topDebtors=custs.filter(c=>c.outstanding>0.0001).slice(0,5);
  const stock=(batches||[]).reduce((a,b)=>{ const t=batchCalc(b); a.spent+=t.spent; a.profit+=t.profitOnStock; return a; },{spent:0,profit:0});

  const lb=new Map();
  (dailies||[]).forEach(d=>(d.items||[]).forEach(it=>{ const nm=cleanName(it.name); if(!nm) return; const key=normKey(nm); const c=saleItemCalc(it); const e=lb.get(key)||{name:nm,qty:0,revenue:0}; e.qty+=c.qty; e.revenue+=c.revenue; lb.set(key,e); }));
  const topItems=[...lb.values()].sort((a,b)=>b.revenue-a.revenue).slice(0,5);
  const topRev=topItems.length?topItems[0].revenue:0;

  const byDay=new Map();
  (dailies||[]).forEach(d=>{ if(!d.date) return; const t=dailyCalc(d), cr=creditOf(d); const e=byDay.get(d.date)||{sales:0,cash:0}; e.sales+=t.revenue; e.cash+=t.revenue-cr; byDay.set(d.date,e); });
  const chartData=[...byDay.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-14).map(([date,v])=>({ name:new Date(date+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"}), Sales:v.sales, Cash:v.cash }));

  const link={background:"transparent",border:"none",color:C.teal,fontSize:12,fontWeight:600,cursor:"pointer",padding:0};
  const lowStock=stockLevels(batches, dailies).filter(r=>r.status!=="ok");

  return(
    <div>
      {/* low-stock warning */}
      {lowStock.length>0 && (
        <Card style={{padding:"12px 16px",marginBottom:14,border:`1px solid ${C.orange}55`,background:"rgba(249,115,22,0.08)",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",cursor:"pointer"}}>
          <div onClick={()=>onGoto("levels")} style={{flex:1,minWidth:200,display:"flex",alignItems:"center",gap:12}}>
            <Ico d={IC.alert} size={20} color={C.orange}/>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.text}}>{lowStock.length} item{lowStock.length===1?"":"s"} need restocking</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>{lowStock.slice(0,4).map(r=>`${r.name} (${r.remaining<=0?"out":r.remaining+" left"})`).join(", ")}{lowStock.length>4?"…":""}</div>
            </div>
          </div>
          <button onClick={()=>onGoto("levels")} style={{...link,color:C.orange,flexShrink:0}}>View stock levels →</button>
        </Card>
      )}

      {/* headline KPIs */}
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:isMobile?10:14,marginBottom:12}}>
        <KPICard label="This Month · Sales"   value={monthT.sales} color={C.blue}/>
        <KPICard label="This Month · Cash In" value={monthT.cash}  color={C.text}/>
        <KPICard label="This Month · You Make" value={monthT.profit} color={monthT.profit>=0?C.green:C.red}/>
        <KPICard label="Owed To You"          value={ctot.outstanding} color={ctot.outstanding>0?C.red:C.green}/>
      </div>

      {/* secondary strip */}
      <Card style={{padding:isMobile?"12px 14px":"14px 22px",marginBottom:16,display:"flex",alignItems:"center",gap:isMobile?14:26,flexWrap:"wrap"}}>
        {[["Today sales",fmt(todayT.sales),C.blue],["Today cash",fmt(todayT.cash),C.text],["Today on credit",fmt(todayT.credit),todayT.credit>0?C.orange:C.muted],
          ["Customers owing",`${ctot.owing}`,C.orange],["Stock spent",fmt(stock.spent),C.text],["Expected stock profit",fmt(stock.profit),C.green]].map(([k,v,col])=>(
          <div key={k}><div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>{k}</div><div style={{fontSize:16,fontWeight:700,color:col,fontVariantNumeric:"tabular-nums"}}>{v}</div></div>
        ))}
      </Card>

      {/* chart */}
      <Card style={{padding:isMobile?16:22,marginBottom:16}}>
        <SLabel style={{marginBottom:16}}>Sales vs. cash collected (per day)</SLabel>
        {chartData.length===0
          ? <div style={{padding:30,textAlign:"center",color:C.muted,fontSize:13}}>No daily sales yet. Tap “Record day” to start.</div>
          : <ResponsiveContainer width="100%" height={isMobile?220:260}>
              <BarChart data={chartData} margin={{top:4,right:4,left:-10,bottom:isMobile?28:8}} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.subtle} vertical={false}/>
                <XAxis dataKey="name" tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false} angle={isMobile?-25:0} textAnchor={isMobile?"end":"middle"} interval={0} height={isMobile?44:24}/>
                <YAxis tick={{fill:C.muted,fontSize:9}} axisLine={false} tickLine={false} width={40} tickFormatter={compact}/>
                <Tooltip {...TT} cursor={{fill:C.tealBg}}/>
                <Bar dataKey="Sales" fill={C.blue} radius={[3,3,0,0]} maxBarSize={26}/>
                <Bar dataKey="Cash"  fill={C.teal} radius={[3,3,0,0]} maxBarSize={26}/>
              </BarChart>
            </ResponsiveContainer>}
      </Card>

      {/* two columns: top items + top debtors */}
      <div style={{display:"grid",gridTemplateColumns:isMobile||isTablet?"1fr":"1fr 1fr",gap:16}}>
        <Card style={{padding:isMobile?16:22}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Ico d={IC.trophy} size={16} color={C.yellow}/><SLabel>Top items</SLabel></div>
            <button onClick={()=>onGoto("daily")} style={link}>View sales →</button>
          </div>
          {topItems.length===0 ? <div style={{fontSize:12,color:C.muted}}>No sales yet.</div>
            : topItems.map((it,i)=>(
              <div key={it.name} style={{marginBottom:i===topItems.length-1?0:12}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:5}}>
                  <span style={{fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{i+1}. {it.name}</span>
                  <span style={{fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(it.revenue)}</span>
                </div>
                <div style={{height:6,borderRadius:4,background:C.subtle,overflow:"hidden"}}><div style={{height:"100%",borderRadius:4,width:`${topRev>0?Math.max(4,it.revenue/topRev*100):0}%`,background:C.teal}}/></div>
              </div>))}
        </Card>

        <Card style={{padding:isMobile?16:22}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Ico d={IC.people} size={16} color={C.orange}/><SLabel>Who owes you</SLabel></div>
            <button onClick={()=>onGoto("credit")} style={link}>Credit book →</button>
          </div>
          {topDebtors.length===0 ? <div style={{fontSize:12,color:C.muted}}>Nobody owes you right now. 🎉</div>
            : topDebtors.map((c,i)=>(
              <div key={c.name} onClick={()=>onOpenCustomer(c.name)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"9px 0",borderTop:i?`1px solid ${C.divider}`:"none",cursor:"pointer"}}>
                <div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</div><div style={{fontSize:10,color:C.muted}}>last {niceDate(c.lastDate)}</div></div>
                <div style={{fontSize:14,fontWeight:700,color:C.red,fontVariantNumeric:"tabular-nums",flexShrink:0}}>{fmt(c.outstanding)}</div>
              </div>))}
        </Card>
      </div>
    </div>
  );
}

function DailySales({dailies, credits, user, onEdit, onDelete, onNew}){
  const C=useTheme(); const TT=useTT();
  const isMobile=useIsMobile(); const isTablet=useIsTablet();
  const [period,setPeriod]=useState("all");   // all | month | today

  // credit given per day (sums the Credit Book entries linked to each day)
  const creditByDay=new Map();
  (credits||[]).forEach(e=>{ if(e.daily_id && e.kind!=="payment") creditByDay.set(e.daily_id,(creditByDay.get(e.daily_id)||0)+nv(e.amount)); });
  const creditOf=d=>creditByDay.get(d.id)||0;

  // Today + this-month totals
  const today=todayStr(); const ym=today.slice(0,7);
  const sumRows=rows=>rows.reduce((a,d)=>{ const t=dailyCalc(d), cr=creditOf(d);
    a.revenue+=t.revenue; a.takeHome+=t.takeHome; a.qty+=t.qty; a.credit+=cr; a.cash+=t.revenue-cr; return a;
  },{revenue:0,takeHome:0,qty:0,credit:0,cash:0});
  const todayT = sumRows(dailies.filter(d=>d.date===today));
  const monthT = sumRows(dailies.filter(d=>String(d.date||"").startsWith(ym)));

  // Leaderboard: aggregate each item across every day (whitespace/case-insensitive)
  const lb=new Map();
  dailies.forEach(d=>(d.items||[]).forEach(it=>{
    const nm=cleanName(it.name); if(!nm) return; const key=normKey(nm);
    const c=saleItemCalc(it); const e=lb.get(key)||{name:nm,qty:0,revenue:0,profit:0};
    e.qty+=c.qty; e.revenue+=c.revenue; e.profit+=c.profit; lb.set(key,e);
  }));
  const leaders=[...lb.values()].sort((a,b)=>b.revenue-a.revenue);
  const topRevenue=leaders.length?leaders[0].revenue:0;
  const MEDAL=["#fbbf24","#94a3b8","#d97706"];

  // Chart: money in per day (most recent 14 days, oldest→newest)
  const byDay=new Map();
  dailies.forEach(d=>{ if(!d.date) return; const t=dailyCalc(d); const e=byDay.get(d.date)||{revenue:0,profit:0};
    e.revenue+=t.revenue; e.profit+=t.takeHome; byDay.set(d.date,e); });
  const chartData=[...byDay.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-14)
    .map(([date,v])=>({ name:new Date(date+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"}), "Money in":v.revenue, Profit:v.profit }));

  if(dailies.length===0){
    return(
      <div style={{textAlign:"center",maxWidth:440,margin:"60px auto",padding:"0 20px"}}>
        <div style={{width:60,height:60,borderRadius:16,background:C.tealBg,border:`1px solid ${C.teal}44`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px"}}>
          <Ico d={IC.cash} size={26} color={C.teal}/>
        </div>
        <div style={{fontSize:18,fontWeight:700,color:C.text}}>No daily sales yet</div>
        <div style={{fontSize:13,color:C.muted,marginTop:6,lineHeight:1.6}}>At the end of each day, record what you sold. You'll instantly see how much you made that day and which item is selling best.</div>
        {canDo(user,"canEdit")&&(
          <button onClick={onNew} style={{marginTop:18,background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"11px 20px",fontWeight:700,fontSize:13,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8}}>
            <Ico d={IC.add} size={16} color="#09111e"/> Record today's sales
          </button>
        )}
      </div>
    );
  }

  return(
    <div>
      {canDo(user,"canEdit")&&(
        <button onClick={onNew} style={{marginBottom:16,background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"11px 18px",fontWeight:700,fontSize:13,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8}}>
          <Ico d={IC.add} size={16} color="#09111e"/> Record today's sales
        </button>
      )}

      {/* KPI row — today's money flow */}
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:isMobile?10:14,marginBottom:12}}>
        <KPICard label="Today · Sales"     value={todayT.revenue} color={C.blue}/>
        <KPICard label="Today · On Credit" value={todayT.credit}  color={todayT.credit>0?C.orange:C.muted}/>
        <KPICard label="Today · Cash In"   value={todayT.cash}    color={C.text}/>
        <KPICard label="Today · You Make"  value={todayT.takeHome} color={todayT.takeHome>=0?C.green:C.red}/>
      </div>
      {/* this-month strip */}
      <Card style={{padding:isMobile?"12px 14px":"12px 20px",marginBottom:16,display:"flex",alignItems:"center",gap:isMobile?14:28,flexWrap:"wrap"}}>
        <span style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:600}}>This month</span>
        {[["Sales",monthT.revenue,C.blue],["On credit",monthT.credit,C.orange],["Cash in",monthT.cash,C.text],["You make",monthT.takeHome,monthT.takeHome>=0?C.green:C.red]].map(([k,v,col])=>(
          <div key={k}><div style={{fontSize:10,color:C.muted}}>{k}</div><div style={{fontSize:15,fontWeight:700,color:col,fontVariantNumeric:"tabular-nums"}}>{fmt(v)}</div></div>
        ))}
      </Card>

      <div style={{display:"grid",gridTemplateColumns:isMobile||isTablet?"1fr":"3fr 2fr",gap:16,marginBottom:16,alignItems:"start"}}>
        {/* chart */}
        <Card style={{padding:isMobile?16:22}}>
          <SLabel style={{marginBottom:16}}>Money in vs. profit (per day)</SLabel>
          <ResponsiveContainer width="100%" height={isMobile?220:260}>
            <BarChart data={chartData} margin={{top:4,right:4,left:-10,bottom:isMobile?28:8}} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.subtle} vertical={false}/>
              <XAxis dataKey="name" tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false}
                angle={isMobile?-25:0} textAnchor={isMobile?"end":"middle"} interval={0} height={isMobile?44:24}/>
              <YAxis tick={{fill:C.muted,fontSize:9}} axisLine={false} tickLine={false} width={40} tickFormatter={compact}/>
              <Tooltip {...TT} cursor={{fill:C.tealBg}}/>
              <Bar dataKey="Money in" fill={C.blue} radius={[3,3,0,0]} maxBarSize={26}/>
              <Bar dataKey="Profit"   fill={C.teal} radius={[3,3,0,0]} maxBarSize={26}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* leaderboard */}
        <Card style={{padding:isMobile?16:22}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
            <Ico d={IC.trophy} size={16} color={C.yellow}/><SLabel>Leading items (by money in)</SLabel>
          </div>
          {leaders.length===0
            ? <div style={{fontSize:12,color:C.muted}}>No items recorded yet.</div>
            : <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {leaders.slice(0,6).map((it,i)=>(
                  <div key={it.name}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:5}}>
                      <span style={{width:22,height:22,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,
                        background:i<3?MEDAL[i]:C.subtle,color:i<3?"#09111e":C.muted}}>{i+1}</span>
                      <div style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{it.name}</div>
                      <div style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(it.revenue)}</div>
                    </div>
                    <div style={{height:6,borderRadius:4,background:C.subtle,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:4,width:`${topRevenue>0?Math.max(4,it.revenue/topRevenue*100):0}%`,background:i<3?MEDAL[i]:C.teal}}/>
                    </div>
                    <div style={{fontSize:10,color:C.muted,marginTop:3}}>{fmt(it.qty)} sold · {fmt(it.profit)} profit</div>
                  </div>
                ))}
              </div>}
        </Card>
      </div>

      {/* daily list */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <SLabel>Daily records</SLabel>
        <SegTabs tabs={[{id:"all",label:"All",count:dailies.length},{id:"month",label:"This month"},{id:"today",label:"Today"}]} value={period} onChange={setPeriod}/>
      </div>
      {(()=>{ const shownDays=dailies.filter(d=>period==="today"?d.date===today:period==="month"?String(d.date||"").startsWith(ym):true);
      return shownDays.length===0
        ? <Card style={{padding:30,textAlign:"center"}}><div style={{fontSize:13,color:C.muted}}>No sales recorded {period==="today"?"today":period==="month"?"this month":"yet"}.</div></Card>
        : (
      /* spreadsheet-style table on every screen (scrolls sideways on small phones) */
      <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",border:`1px solid ${C.cardB}`,borderRadius:12,background:C.card}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:720}}>
            <thead>
              <tr style={{background:C.inputBg}}>
                {[["Date",0],["Sold",1],["Best seller",0],["Sales",1],["On credit",1],["Cash",1],["You make",1],["",0]].map(([h,r],i)=>(
                  <th key={i} style={{textAlign:r?"right":"left",fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",color:C.muted,fontWeight:600,padding:"11px 14px",borderBottom:`1px solid ${C.cardB}`,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownDays.map(d=>{
                const t=dailyCalc(d); const cr=creditOf(d); const cash=t.revenue-cr;
                const top=[...(d.items||[])].map(it=>({name:cleanName(it.name),...saleItemCalc(it)})).sort((a,b)=>b.revenue-a.revenue)[0];
                const tdN={padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,textAlign:"right",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap",fontWeight:600,fontSize:13};
                return(
                  <tr key={d.id}>
                    <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,whiteSpace:"nowrap"}}>
                      <span style={{fontWeight:700,color:C.text,fontSize:13}}>{niceDate(d.date)}</span>
                      {d.date===today&&<span style={{fontSize:10,marginLeft:6,padding:"1px 7px",borderRadius:20,background:C.tealBg,color:C.teal,fontWeight:600}}>Today</span>}
                      {d.note&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>{d.note}</div>}
                    </td>
                    <td style={{...tdN,color:C.text}}>{fmt(t.qty)}</td>
                    <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,color:C.text,fontSize:13,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{top?top.name:"—"}</td>
                    <td style={{...tdN,color:C.blue}}>{fmt(t.revenue)}</td>
                    <td style={{...tdN,color:cr>0?C.orange:C.muted,fontWeight:cr>0?600:400}}>{cr>0?fmt(cr):"—"}</td>
                    <td style={{...tdN,color:C.text}}>{fmt(cash)}</td>
                    <td style={{...tdN,color:t.takeHome>=0?C.green:C.red}}>{t.takeHome>=0?"+":""}{fmt(t.takeHome)}</td>
                    <td style={{padding:"10px 10px",borderBottom:`1px solid ${C.divider}`,textAlign:"right",whiteSpace:"nowrap"}}>
                      <div style={{display:"inline-flex",gap:6}}>
                        {canDo(user,"canEdit")&&(
                          <button onClick={()=>onEdit(d)} title="Edit" style={{background:C.tealBg,border:`1px solid ${C.teal}44`,borderRadius:6,padding:6,cursor:"pointer",display:"flex"}}>
                            <Ico d={IC.edit} size={14} color={C.teal}/>
                          </button>
                        )}
                        {canDo(user,"canDelete")&&(
                          <button onClick={()=>onDelete(d)} title="Delete" style={{background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:6,padding:6,cursor:"pointer",display:"flex"}}>
                            <Ico d={IC.trash} size={14} color={C.red}/>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {(()=>{ const g=shownDays.reduce((a,d)=>{ const t=dailyCalc(d), cr=creditOf(d); a.qty+=t.qty; a.revenue+=t.revenue; a.takeHome+=t.takeHome; a.credit+=cr; a.cash+=t.revenue-cr; return a; },{qty:0,revenue:0,takeHome:0,credit:0,cash:0});
                const tf={padding:"11px 14px",textAlign:"right",fontWeight:700,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"};
                return(
                  <tr style={{background:C.inputBg}}>
                    <td style={{padding:"11px 14px",fontWeight:700,color:C.text,fontSize:12}}>{shownDays.length} day{shownDays.length===1?"":"s"}</td>
                    <td style={{...tf,color:C.text}}>{fmt(g.qty)}</td>
                    <td/>
                    <td style={{...tf,color:C.blue}}>{fmt(g.revenue)}</td>
                    <td style={{...tf,color:g.credit>0?C.orange:C.muted}}>{fmt(g.credit)}</td>
                    <td style={{...tf,color:C.text}}>{fmt(g.cash)}</td>
                    <td style={{...tf,color:g.takeHome>=0?C.green:C.red}}>{g.takeHome>=0?"+":""}{fmt(g.takeHome)}</td>
                    <td/>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
      ); })()}
    </div>
  );
}

// ── DAILY SALES ENTRY ─────────────────────────────────────────────────────────
const blankSale = () => ({ id:uid(), name:"", qtySold:"", sellPrice:"", costPrice:"" });
const blankCreditLine = () => ({ id:uid(), customer:"", amount:"" });
const toDailyDraft = (d, linked) => {
  const creditRows=(linked||[]).map(e=>({ id:e.id||uid(), customer:e.customer||"", amount:String(e.amount??"") }));
  return d
    ? { id:d.id, date:d.date||"", note:d.note||"", expenses:String(d.expenses??""),
        items:(d.items||[]).map(it=>({ id:it.id||uid(), name:it.name,
          qtySold:String(it.qtySold??""), sellPrice:String(it.sellPrice??""), costPrice:String(it.costPrice??"") })),
        credits:creditRows }
    : { id:null, date:todayStr(), note:"", expenses:"", items:[blankSale()], credits:[] };
};

function DailyEntry({initial, products, customers, linkedCredits, stock, onSaved, onCancel}){
  const C=useTheme(); const isMobile=useIsMobile();
  const [draft,setDraft]=useState(()=>toDailyDraft(initial, linkedCredits));
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const isEdit=Boolean(initial);
  const prodByName=React.useMemo(()=>{ const m=new Map(); (products||[]).forEach(p=>m.set(normKey(p.name),p)); return m; },[products]);

  // Cost per piece is automatic: read it from the matching stock product.
  // Falls back to any cost stored on the row (old records) when the item isn't in stock.
  const matchOf=(it)=>prodByName.get(normKey(it.name));
  const costFor=(it)=>{ const p=matchOf(it); return p ? nv(p.costPrice) : nv(it.costPrice); };
  const withCost=(it)=>({...it, costPrice:costFor(it)});  // resolved item for calc/save

  const setField=(k,v)=>setDraft(d=>({...d,[k]:v}));
  const setItem=(id,k,v)=>setDraft(d=>({...d,items:d.items.map(it=>it.id===id?{...it,[k]:v}:it)}));
  const addItem=()=>setDraft(d=>({...d,items:[...d.items,blankSale()]}));
  const removeItem=(id)=>setDraft(d=>({...d,items:d.items.filter(it=>it.id!==id)}));
  // when an item name matches a known product, auto-fill its sell price (only if still blank);
  // its cost always comes from stock automatically (see costFor)
  const pickName=(id,name)=>setDraft(d=>({...d,items:d.items.map(it=>{
    if(it.id!==id) return it; const p=prodByName.get(normKey(name)); if(!p) return {...it,name};
    return {...it,name, sellPrice:it.sellPrice||String(p.sellPrice||"")};
  })}));
  // on-credit lines (part of the bill a customer couldn't pay → goes to the Credit Book)
  const setCredit=(id,k,v)=>setDraft(d=>({...d,credits:d.credits.map(c=>c.id===id?{...c,[k]:v}:c)}));
  const addCredit=()=>setDraft(d=>({...d,credits:[...d.credits,blankCreditLine()]}));
  const removeCredit=(id)=>setDraft(d=>({...d,credits:d.credits.filter(c=>c.id!==id)}));

  const totals=dailyCalc({...draft, items:draft.items.map(withCost)});
  const creditTotal=draft.credits.reduce((s,c)=>s+(c.customer.trim()?nv(c.amount):0),0);
  const cash=totals.revenue-creditTotal;

  async function save(){
    const items=draft.items.filter(it=>it.name.trim()!=="").map(it=>({
      id:it.id, name:it.name.trim(), qtySold:nv(it.qtySold), sellPrice:nv(it.sellPrice), costPrice:costFor(it) }));
    const creditLines=draft.credits.filter(c=>c.customer.trim()!=="" && nv(c.amount)>0)
      .map(c=>({ customer:c.customer.trim(), amount:nv(c.amount) }));
    if(!draft.date){ setError("Pick the date for these sales."); return; }
    if(items.length===0){ setError("Add at least one item that you sold."); return; }
    setError(""); setBusy(true);
    const payload={ date:draft.date, note:draft.note.trim()||null, expenses:nv(draft.expenses), items };
    try{
      const rows = isEdit ? await dailyDb.patch(draft.id,payload) : await dailyDb.insert(payload);
      const dayRow = rows && rows[0] ? rows[0] : { ...payload, id:draft.id||uid() };
      // sync this day's on-credit lines into the Credit Book: drop the old linked ones, insert the new
      const removedIds=(linkedCredits||[]).map(e=>e.id);
      await Promise.all(removedIds.map(id=>creditDb.remove(id)));
      let added=[];
      if(creditLines.length){
        const inserted=await Promise.all(creditLines.map(cl=>creditDb.insert({
          customer:cl.customer, phone:null, date:dayRow.date||payload.date, kind:"credit",
          amount:cl.amount, note:"From daily sales", items:[], daily_id:dayRow.id })));
        added=inserted.map(r=>Array.isArray(r)?r[0]:r).filter(Boolean);
      }
      onSaved(dayRow, { removedIds, added });
    }catch(e){
      console.error(e);
      const msg=String(e&&e.message||"");
      let nice="Could not save — check your connection and try again.";
      if(/daily_sales|credit_entries/i.test(msg)&&/(exist|relation|schema cache|column)/i.test(msg)) nice="A database column is missing — run the latest schema in Supabase.";
      else if(/row-level security|policy/i.test(msg)) nice="Supabase blocked the save (row-level security).";
      else if(msg) nice="Could not save: "+msg.replace(/\s+/g," ").slice(0,180);
      setError(nice); setBusy(false);
    }
  }

  const lbl={fontSize:11,color:C.muted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"};
  const focus=e=>e.target.style.borderColor=C.teal, blur=e=>e.target.style.borderColor=C.cardB;

  return(
    <div style={{paddingBottom:90}}>
      <datalist id="hzx-products">{(products||[]).map(p=><option key={p.name} value={p.name}/>)}</datalist>
      <datalist id="hzx-customers">{(customers||[]).map(c=><option key={c.name} value={c.name}/>)}</datalist>
      <button onClick={onCancel} style={{display:"inline-flex",alignItems:"center",gap:6,background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:13,marginBottom:14}}>
        <Ico d={IC.back} size={15} color={C.muted}/> Back to daily sales
      </button>

      {/* day details */}
      <Card style={{padding:isMobile?16:22,marginBottom:16}}>
        <SLabel style={{marginBottom:14}}>{isEdit?"Edit day":"New day"}</SLabel>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:12}}>
          <div><label style={lbl}>Date</label>
            <input type="date" value={draft.date} style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("date",e.target.value)}/></div>
          <div><label style={lbl}>Note (optional)</label>
            <input value={draft.note} placeholder="e.g. busy Friday" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("note",e.target.value)}/></div>
          <div><label style={lbl}>Day's expenses (SSP)</label>
            <input type="number" inputMode="decimal" value={draft.expenses} placeholder="0" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("expenses",e.target.value)}/></div>
        </div>
      </Card>

      {/* items sold */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <SLabel>Items sold today</SLabel>
        <span style={{fontSize:12,color:C.muted}}>{draft.items.length} row{draft.items.length===1?"":"s"}</span>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {draft.items.map((it,idx)=>{
          const cost=costFor(it); const inStock=!!matchOf(it);
          const named=it.name.trim()!==""; const knownCost=inStock||nv(it.costPrice)>0;
          const c=saleItemCalc({...it,costPrice:cost});
          const st=stock&&stock.get(normKey(it.name));
          const remain=st?st.remaining:null;                       // pieces left before this sale
          const over=remain!=null && nv(it.qtySold)>remain;        // selling more than what's left
          return(
            <Card key={it.id} style={{padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                <span style={{width:24,height:24,borderRadius:6,background:C.tealBg,color:C.teal,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{idx+1}</span>
                <input value={it.name} list="hzx-products" placeholder="Item sold (e.g. Tusker)" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>pickName(it.id,e.target.value)}/>
                <button onClick={()=>removeItem(it.id)} title="Remove" style={{background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:6,padding:8,cursor:"pointer",display:"flex",flexShrink:0}}>
                  <Ico d={IC.trash} size={15} color={C.red}/>
                </button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
                {[["Qty sold","qtySold"],["Sell price / piece","sellPrice"]].map(([label,key])=>(
                  <div key={key}><label style={lbl}>{label}</label>
                    <input type="number" inputMode="decimal" value={it[key]} placeholder="0" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setItem(it.id,key,e.target.value)}/></div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:12}}>
                {/* Cost / piece — read-only, pulled from stock */}
                <div style={{background:C.inputBg,borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Cost / piece {knownCost?"· from stock":""}</div>
                  {knownCost
                    ? <div style={{fontSize:13,fontWeight:600,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(cost)}</div>
                    : <div style={{fontSize:11,fontWeight:600,color:C.orange}}>{named?"not in stock":"—"}</div>}
                </div>
                {[["Money in",c.revenue,C.blue],["Profit",c.profit,c.profit>=0?C.green:C.red]].map(([label,val,col])=>(
                  <div key={label} style={{background:C.inputBg,borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
                    <div style={{fontSize:13,fontWeight:600,color:col,fontVariantNumeric:"tabular-nums"}}>{fmt(val)}</div>
                  </div>
                ))}
              </div>
              {named&&!knownCost&&(
                <div style={{fontSize:11,color:C.muted,marginTop:8,display:"flex",alignItems:"center",gap:6}}>
                  <Ico d={IC.alert} size={13} color={C.orange}/> Pick the item from the list, or add it under Add Stock, so its cost is known.
                </div>
              )}
              {named&&remain!=null&&(
                <div style={{fontSize:11,marginTop:8,display:"flex",alignItems:"center",gap:6,color:over?C.red:C.muted}}>
                  <Ico d={IC.box} size={13} color={over?C.red:(remain<=0?C.orange:C.muted)}/>
                  {over
                    ? `Only ${fmt(remain)} left in stock — you're recording ${fmt(it.qtySold)} sold.`
                    : (remain<=0 ? "Out of stock — record a stock purchase first." : `${fmt(remain)} left in stock`)}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <button onClick={addItem} style={{marginTop:12,width:"100%",background:C.tealBg,border:`1px dashed ${C.teal}66`,borderRadius:10,color:C.teal,padding:"12px",fontWeight:600,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <Ico d={IC.add} size={16} color={C.teal}/> Add another item
      </button>

      {/* given on credit — the part of today's bill a customer couldn't pay (goes to the Credit Book) */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"22px 0 12px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Ico d={IC.people} size={15} color={C.orange}/><SLabel>Taken on credit (unpaid)</SLabel>
        </div>
        <span style={{fontSize:12,color:C.muted}}>owed today: <strong style={{color:creditTotal>0?C.orange:C.muted}}>{fmt(creditTotal)}</strong></span>
      </div>
      {draft.credits.length===0
        ? <div style={{fontSize:12,color:C.muted,padding:"4px 2px 0",lineHeight:1.6}}>Everyone paid cash. If a customer drank but couldn't pay, add them below — it'll appear in the Credit Book as money they owe.</div>
        : <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {draft.credits.map(c=>(
              <Card key={c.id} style={{padding:12}}>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr auto":"2fr 1fr auto",gap:10,alignItems:"end"}}>
                  <div><label style={lbl}>Customer</label>
                    <input value={c.customer} list="hzx-customers" placeholder="e.g. John Deng" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setCredit(c.id,"customer",e.target.value)}/></div>
                  <div><label style={lbl}>On credit (SSP)</label>
                    <input type="number" inputMode="decimal" value={c.amount} placeholder="0" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setCredit(c.id,"amount",e.target.value)}/></div>
                  <button onClick={()=>removeCredit(c.id)} title="Remove" style={{background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:6,padding:10,cursor:"pointer",display:"flex",justifyContent:"center"}}>
                    <Ico d={IC.trash} size={15} color={C.red}/>
                  </button>
                </div>
              </Card>
            ))}
          </div>}
      <button onClick={addCredit} style={{marginTop:10,width:"100%",background:"rgba(249,115,22,0.08)",border:`1px dashed ${C.orange}66`,borderRadius:10,color:C.orange,padding:"11px",fontWeight:600,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <Ico d={IC.add} size={16} color={C.orange}/> Put a customer on credit
      </button>
      {creditTotal>totals.revenue&&(
        <div style={{marginTop:10,fontSize:11,color:C.orange,display:"flex",alignItems:"center",gap:6}}>
          <Ico d={IC.alert} size={13} color={C.orange}/> Credit given is more than today's sales — double-check the amounts.
        </div>
      )}

      {error&&(
        <div style={{marginTop:14,padding:"10px 14px",background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:8,fontSize:12,color:C.red,display:"flex",alignItems:"center",gap:8}}>
          <Ico d={IC.alert} size={15} color={C.red}/> {error}
        </div>
      )}

      {/* sticky save bar */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.header,borderTop:`1px solid ${C.cardB}`,zIndex:20}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:isMobile?"10px 14px":"12px 28px",display:"flex",alignItems:"center",gap:16}}>
          {!isMobile&&(
            <div style={{display:"flex",gap:22,flex:1}}>
              <div><div style={{fontSize:10,color:C.muted}}>Sales</div><div style={{fontSize:15,fontWeight:700,color:C.blue,fontVariantNumeric:"tabular-nums"}}>{fmt(totals.revenue)}</div></div>
              <div><div style={{fontSize:10,color:C.muted}}>On credit</div><div style={{fontSize:15,fontWeight:700,color:creditTotal>0?C.orange:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmt(creditTotal)}</div></div>
              <div><div style={{fontSize:10,color:C.muted}}>Cash in</div><div style={{fontSize:15,fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(cash)}</div></div>
              <div><div style={{fontSize:10,color:C.muted}}>You make</div><div style={{fontSize:15,fontWeight:700,color:totals.takeHome>=0?C.green:C.red,fontVariantNumeric:"tabular-nums"}}>{totals.takeHome>=0?"+":""}{fmt(totals.takeHome)}</div></div>
            </div>
          )}
          {isMobile&&<div style={{flex:1}}><div style={{fontSize:10,color:C.muted}}>Cash in · You make</div><div style={{fontSize:15,fontWeight:700,color:C.text}}>{fmt(cash)} · <span style={{color:totals.takeHome>=0?C.green:C.red}}>{totals.takeHome>=0?"+":""}{fmt(totals.takeHome)}</span></div></div>}
          <button onClick={onCancel} disabled={busy} style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"10px 16px",fontSize:13,cursor:"pointer",opacity:busy?0.5:1}}>Cancel</button>
          <button onClick={save} disabled={busy} style={{background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"10px 20px",fontWeight:700,fontSize:13,cursor:busy?"not-allowed":"pointer",opacity:busy?0.7:1,display:"flex",alignItems:"center",gap:8}}>
            <Ico d={IC.check} size={16} color="#09111e"/> {busy?"Saving…":isEdit?"Save changes":"Save day"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CREDIT BOOK (customer debts) ──────────────────────────────────────────────
function CreditBook({entries, user, onGiveCredit, onOpenCustomer, onEditCustomer, onDeleteCustomer}){
  const C=useTheme(); const isMobile=useIsMobile();
  const [filter,setFilter]=useState("all");   // all | open | settled
  const custs=customersFromEntries(entries);
  const tot=creditTotals(entries);
  const openCount=custs.filter(c=>custStatusKey(c)==="open").length;
  const shown=custs.filter(c=>filter==="all"?true:custStatusKey(c)===filter);
  const filterTabs=[{id:"all",label:"All",count:custs.length},{id:"open",label:"Open",count:openCount},{id:"settled",label:"Settled",count:custs.length-openCount}];

  if(entries.length===0){
    return(
      <div style={{textAlign:"center",maxWidth:440,margin:"60px auto",padding:"0 20px"}}>
        <div style={{width:60,height:60,borderRadius:16,background:C.tealBg,border:`1px solid ${C.teal}44`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px"}}>
          <Ico d={IC.people} size={26} color={C.teal}/>
        </div>
        <div style={{fontSize:18,fontWeight:700,color:C.text}}>No customer credit yet</div>
        <div style={{fontSize:13,color:C.muted,marginTop:6,lineHeight:1.6}}>When a customer takes drinks on credit, record it here. You'll always know who owes you and how much.</div>
        {canDo(user,"canEdit")&&(
          <button onClick={()=>onGiveCredit()} style={{marginTop:18,background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"11px 20px",fontWeight:700,fontSize:13,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8}}>
            <Ico d={IC.add} size={16} color="#09111e"/> Give credit
          </button>
        )}
      </div>
    );
  }

  return(
    <div>
      {canDo(user,"canEdit")&&(
        <button onClick={()=>onGiveCredit()} style={{marginBottom:16,background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"11px 18px",fontWeight:700,fontSize:13,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8}}>
          <Ico d={IC.add} size={16} color="#09111e"/> Give credit
        </button>
      )}

      {/* KPI row */}
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:isMobile?10:14,marginBottom:16}}>
        <KPICard label="Owed To You"     value={tot.outstanding} color={tot.outstanding>0?C.red:C.green}/>
        <KPICard label="Customers Owing" value={tot.owing} suffix="people" color={C.orange}/>
        <KPICard label="Credit Given"    value={tot.given}  color={C.blue}/>
        <KPICard label="Repaid"          value={tot.repaid} color={C.green}/>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <SLabel>Customers</SLabel>
        <SegTabs tabs={filterTabs} value={filter} onChange={setFilter}/>
      </div>
      {shown.length===0 ? (
        <Card style={{padding:30,textAlign:"center"}}><div style={{fontSize:13,color:C.muted}}>No {filter==="open"?"open debts":filter==="settled"?"settled customers":"customers"} to show.</div></Card>
      ) : isMobile ? (
        <div style={{display:"grid",gridTemplateColumns:"1fr",gap:12}}>
          {shown.map(c=>(
            <Card key={c.name} style={{padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{minWidth:0,cursor:"pointer"}} onClick={()=>onOpenCustomer(c.name)}>
                  <div style={{fontSize:15,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{c.phone?c.phone+" · ":""}{c.count} entr{c.count===1?"y":"ies"} · last {niceDate(c.lastDate)}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{display:"flex",justifyContent:"flex-end",marginBottom:3}}><StatusBadge outstanding={c.outstanding}/></div>
                  <div style={{fontSize:18,fontWeight:700,color:c.outstanding>0?C.red:C.green,fontVariantNumeric:"tabular-nums"}}>{fmt(Math.max(0,c.outstanding))}</div>
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,paddingTop:10,borderTop:`1px solid ${C.divider}`}}>
                <div style={{display:"flex",gap:16,fontSize:12,color:C.muted}}>
                  <span>Taken <strong style={{color:C.text}}>{fmt(c.taken)}</strong></span>
                  <span>Paid <strong style={{color:C.text}}>{fmt(c.paid)}</strong></span>
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  {canDo(user,"canEdit")&&(
                    <button onClick={()=>onEditCustomer(c)} title="Edit customer" style={{background:C.tealBg,border:`1px solid ${C.teal}44`,borderRadius:6,padding:6,cursor:"pointer",display:"flex"}}>
                      <Ico d={IC.edit} size={14} color={C.teal}/>
                    </button>
                  )}
                  {canDo(user,"canDelete")&&(
                    <button onClick={()=>onDeleteCustomer(c)} title="Delete customer" style={{background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:6,padding:6,cursor:"pointer",display:"flex"}}>
                      <Ico d={IC.trash} size={14} color={C.red}/>
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div style={{overflowX:"auto",border:`1px solid ${C.cardB}`,borderRadius:12,background:C.card}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:680}}>
            <thead>
              <tr style={{background:C.inputBg}}>
                {[["Customer",0],["Phone",0],["Status",0],["Taken",1],["Paid",1],["Outstanding",1],["Last",0],["",0]].map(([h,r],i)=>(
                  <th key={i} style={{textAlign:r?"right":"left",fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",color:C.muted,fontWeight:600,padding:"11px 14px",borderBottom:`1px solid ${C.cardB}`,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(c=>{
                const tdN={padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,textAlign:"right",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap",fontWeight:600,fontSize:13};
                return(
                  <tr key={c.name} onClick={()=>onOpenCustomer(c.name)} style={{cursor:"pointer"}}>
                    <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,fontWeight:700,color:C.text,fontSize:13,whiteSpace:"nowrap"}}>{c.name}</td>
                    <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,color:C.muted,fontSize:13,whiteSpace:"nowrap"}}>{c.phone||"—"}</td>
                    <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,whiteSpace:"nowrap"}}><StatusBadge outstanding={c.outstanding}/></td>
                    <td style={{...tdN,color:C.text}}>{fmt(c.taken)}</td>
                    <td style={{...tdN,color:C.text}}>{fmt(c.paid)}</td>
                    <td style={{...tdN,color:c.outstanding>0?C.red:C.green}}>{fmt(Math.max(0,c.outstanding))}</td>
                    <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,color:C.muted,fontSize:12,whiteSpace:"nowrap"}}>{niceDate(c.lastDate)}</td>
                    <td style={{padding:"10px 10px",borderBottom:`1px solid ${C.divider}`,textAlign:"right",whiteSpace:"nowrap"}}>
                      <div style={{display:"inline-flex",gap:6,alignItems:"center"}}>
                        {canDo(user,"canEdit")&&(
                          <button onClick={e=>{e.stopPropagation();onEditCustomer(c);}} title="Edit customer" style={{background:C.tealBg,border:`1px solid ${C.teal}44`,borderRadius:6,padding:6,cursor:"pointer",display:"flex"}}>
                            <Ico d={IC.edit} size={14} color={C.teal}/>
                          </button>
                        )}
                        {canDo(user,"canDelete")&&(
                          <button onClick={e=>{e.stopPropagation();onDeleteCustomer(c);}} title="Delete customer" style={{background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:6,padding:6,cursor:"pointer",display:"flex"}}>
                            <Ico d={IC.trash} size={14} color={C.red}/>
                          </button>
                        )}
                        <Ico d="M9 18l6-6-6-6" size={15} color={C.muted}/>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {(()=>{ const s=shown.reduce((a,c)=>{ a.taken+=c.taken; a.paid+=c.paid; a.out+=Math.max(0,c.outstanding); return a; },{taken:0,paid:0,out:0});
                return(
                  <tr style={{background:C.inputBg}}>
                    <td style={{padding:"11px 14px",fontWeight:700,color:C.text,fontSize:12}}>{shown.length} customer{shown.length===1?"":"s"}</td>
                    <td/><td/>
                    <td style={{padding:"11px 14px",textAlign:"right",fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(s.taken)}</td>
                    <td style={{padding:"11px 14px",textAlign:"right",fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(s.paid)}</td>
                    <td style={{padding:"11px 14px",textAlign:"right",fontWeight:700,color:s.out>0?C.red:C.green,fontVariantNumeric:"tabular-nums"}}>{fmt(s.out)}</td>
                    <td colSpan={2}/>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// Customer ledger — a modal showing one customer's credit/payment history + running balance
function CustomerDetail({name, entries, user, onClose, onGiveCredit, onRecordPayment, onEdit, onDelete}){
  const C=useTheme(); const isMobile=useIsMobile();
  const mine=(entries||[]).filter(e=>normKey(e.customer)===normKey(name))
    .slice().sort((a,b)=> String(a.date||"").localeCompare(String(b.date||"")) || String(a.created_at||"").localeCompare(String(b.created_at||"")));
  const phone=mine.map(e=>e.phone).filter(Boolean).pop()||"";
  let bal=0; const rows=mine.map(e=>{ bal+=creditSigned(e); return {e, bal}; }).reverse();
  const outstanding=bal;

  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:isMobile?12:24,overflowY:"auto"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.cardB}`,borderRadius:14,width:"100%",maxWidth:520,margin:"24px 0"}}>
        <div style={{padding:isMobile?"16px 16px":"20px 22px",borderBottom:`1px solid ${C.cardB}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:18,fontWeight:800,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}</div>
            {phone&&<div style={{fontSize:12,color:C.muted,marginTop:2}}>{phone}</div>}
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Outstanding</div>
            <div style={{fontSize:22,fontWeight:800,color:outstanding>0?C.red:C.green,fontVariantNumeric:"tabular-nums"}}>{fmt(Math.max(0,outstanding))}</div>
          </div>
        </div>

        {canDo(user,"canEdit")&&(
          <div style={{display:"flex",gap:10,padding:isMobile?"12px 16px":"14px 22px",borderBottom:`1px solid ${C.divider}`}}>
            <button onClick={()=>onGiveCredit({customer:name,phone,kind:"credit"})} style={{flex:1,background:C.tealBg,border:`1px solid ${C.teal}44`,borderRadius:8,color:C.teal,padding:"10px",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
              <Ico d={IC.add} size={15} color={C.teal}/> Give credit
            </button>
            <button onClick={()=>onRecordPayment({customer:name,phone,kind:"payment"})} style={{flex:1,background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,color:C.green,padding:"10px",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
              <Ico d={IC.check} size={15} color={C.green}/> Record payment
            </button>
          </div>
        )}

        <div style={{padding:isMobile?"8px 12px 12px":"10px 16px 16px",maxHeight:"50vh",overflowY:"auto"}}>
          {rows.map(({e,bal})=>{
            const isPay=e.kind==="payment";
            return(
              <div key={e.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 6px",borderBottom:`1px solid ${C.divider}`}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:10,fontWeight:700,padding:"1px 8px",borderRadius:20,background:isPay?"rgba(16,185,129,0.12)":"rgba(240,82,82,0.12)",color:isPay?C.green:C.red}}>{isPay?"PAID":"CREDIT"}</span>
                    <span style={{fontSize:12,color:C.muted}}>{niceDate(e.date)}</span>
                  </div>
                  {(e.note||(e.items||[]).length>0)&&(
                    <div style={{fontSize:11,color:C.muted,marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {(e.items||[]).length>0 ? (e.items||[]).map(it=>`${fmt(it.qty)}× ${it.name}`).join(", ") : e.note}
                    </div>
                  )}
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:14,fontWeight:700,color:isPay?C.green:C.text,fontVariantNumeric:"tabular-nums"}}>{isPay?"−":"+"}{fmt(e.amount)}</div>
                  <div style={{fontSize:10,color:C.muted}}>bal {fmt(bal)}</div>
                </div>
                {canDo(user,"canEdit")&&(
                  <button onClick={()=>onEdit(e)} title="Edit" style={{background:"transparent",border:"none",cursor:"pointer",padding:4,display:"flex",flexShrink:0}}>
                    <Ico d={IC.edit} size={14} color={C.muted}/>
                  </button>
                )}
                {canDo(user,"canDelete")&&(
                  <button onClick={()=>onDelete(e)} title="Delete" style={{background:"transparent",border:"none",cursor:"pointer",padding:4,display:"flex",flexShrink:0}}>
                    <Ico d={IC.trash} size={14} color={C.red}/>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{padding:"12px 16px",borderTop:`1px solid ${C.cardB}`,textAlign:"right"}}>
          <button onClick={onClose} style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"9px 18px",fontSize:13,cursor:"pointer"}}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Edit a customer's name & phone across all their entries
function EditCustomer({customer, onCancel, onSave}){
  const C=useTheme();
  const [name,setName]=useState(customer.name);
  const [phone,setPhone]=useState(customer.phone||"");
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const focus=e=>e.target.style.borderColor=C.teal, blur=e=>e.target.style.borderColor=C.cardB;
  const lbl={fontSize:11,color:C.muted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"};
  async function submit(){
    if(!name.trim()){ setError("Name can't be empty."); return; }
    setBusy(true); setError("");
    try{ await onSave(name.trim(), phone.trim()); }
    catch(e){ console.error(e); setError("Could not save the change. Try again."); setBusy(false); }
  }
  return(
    <div onClick={onCancel} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:55,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.cardB}`,borderRadius:12,padding:24,maxWidth:400,width:"100%"}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:4}}>Edit customer</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Updates this customer's name & phone on all {customer.count} of their entries.</div>
        <div style={{marginBottom:12}}><label style={lbl}>Name</label>
          <input value={name} autoFocus style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>{setName(e.target.value);setError("");}}/></div>
        <div><label style={lbl}>Phone (optional)</label>
          <input value={phone} placeholder="09xx…" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setPhone(e.target.value)}/></div>
        {error&&<div style={{marginTop:12,fontSize:12,color:C.red}}>{error}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20}}>
          <button onClick={onCancel} disabled={busy} style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"9px 16px",fontSize:13,cursor:"pointer",opacity:busy?0.5:1}}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"9px 18px",fontWeight:700,fontSize:13,cursor:busy?"not-allowed":"pointer",opacity:busy?0.7:1}}>{busy?"Saving…":"Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ── CREDIT / PAYMENT ENTRY ────────────────────────────────────────────────────
const blankCreditItem = () => ({ id:uid(), name:"", qty:"", price:"" });
const toCreditDraft = (e, preset) => e
  ? { id:e.id, customer:e.customer||"", phone:e.phone||"", date:e.date||"", kind:e.kind||"credit",
      amount:String(e.amount??""), note:e.note||"",
      items:(e.items||[]).map(it=>({ id:it.id||uid(), name:it.name||"", qty:String(it.qty??""), price:String(it.price??"") })) }
  : { id:null, customer:preset?.customer||"", phone:preset?.phone||"", date:todayStr(), kind:preset?.kind||"credit",
      amount:"", note:"", items:[blankCreditItem()] };

function CreditEntry({initial, preset, products, customers, onSaved, onCancel}){
  const C=useTheme(); const isMobile=useIsMobile();
  const [draft,setDraft]=useState(()=>toCreditDraft(initial, preset));
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const isEdit=Boolean(initial);
  const prodByName=React.useMemo(()=>{ const m=new Map(); (products||[]).forEach(p=>m.set(normKey(p.name),p)); return m; },[products]);

  const isCredit=draft.kind==="credit";
  const namedItems=draft.items.filter(it=>it.name.trim()!=="");
  const itemsAmount=namedItems.reduce((s,it)=>s+nv(it.qty)*nv(it.price),0);
  const hasItems=namedItems.length>0;
  const amount=isCredit ? (hasItems?itemsAmount:nv(draft.amount)) : nv(draft.amount);

  const setField=(k,v)=>setDraft(d=>({...d,[k]:v}));
  const setItem=(id,k,v)=>setDraft(d=>({...d,items:d.items.map(it=>it.id===id?{...it,[k]:v}:it)}));
  const addItem=()=>setDraft(d=>({...d,items:[...d.items,blankCreditItem()]}));
  const removeItem=(id)=>setDraft(d=>({...d,items:d.items.filter(it=>it.id!==id)}));
  const pickName=(id,name)=>setDraft(d=>({...d,items:d.items.map(it=>{
    if(it.id!==id) return it; const p=prodByName.get(normKey(name)); if(!p) return {...it,name};
    return {...it,name, price:it.price||String(p.sellPrice||"")};
  })}));

  async function save(){
    if(!draft.customer.trim()){ setError("Enter the customer's name."); return; }
    const items=isCredit ? namedItems.map(it=>({ id:it.id, name:it.name.trim(), qty:nv(it.qty), price:nv(it.price) })) : [];
    if(!(amount>0)){ setError(isCredit?"Enter an amount, or add items they took.":"Enter the amount received."); return; }
    if(!draft.date){ setError("Pick a date."); return; }
    setError(""); setBusy(true);
    const payload={ customer:draft.customer.trim(), phone:draft.phone.trim()||null, date:draft.date, kind:draft.kind, amount, note:draft.note.trim()||null, items };
    try{
      const rows = isEdit ? await creditDb.patch(draft.id,payload) : await creditDb.insert(payload);
      onSaved(rows && rows[0] ? rows[0] : { ...payload, id:draft.id||uid() });
    }catch(e){
      console.error(e);
      const msg=String(e&&e.message||"");
      let nice="Could not save — check your connection and try again.";
      if(/credit_entries/i.test(msg)&&/(exist|relation|schema cache)/i.test(msg)) nice="The credit_entries table isn't set up yet in Supabase.";
      else if(/row-level security|policy/i.test(msg)) nice="Supabase blocked the save (row-level security) — add an anon policy to credit_entries.";
      else if(msg) nice="Could not save: "+msg.replace(/\s+/g," ").slice(0,180);
      setError(nice); setBusy(false);
    }
  }

  const lbl={fontSize:11,color:C.muted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"};
  const focus=e=>e.target.style.borderColor=C.teal, blur=e=>e.target.style.borderColor=C.cardB;
  const kindBtn=(k,label,col)=>(
    <button onClick={()=>setField("kind",k)} style={{flex:1,padding:"10px",borderRadius:8,fontWeight:700,fontSize:13,cursor:"pointer",
      border:`1px solid ${draft.kind===k?col:C.cardB}`, background:draft.kind===k?`${col}1a`:"transparent", color:draft.kind===k?col:C.muted}}>{label}</button>
  );

  return(
    <div style={{paddingBottom:90}}>
      <datalist id="hzx-customers">{(customers||[]).map(c=><option key={c.name} value={c.name}/>)}</datalist>
      <datalist id="hzx-products">{(products||[]).map(p=><option key={p.name} value={p.name}/>)}</datalist>
      <button onClick={onCancel} style={{display:"inline-flex",alignItems:"center",gap:6,background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:13,marginBottom:14}}>
        <Ico d={IC.back} size={15} color={C.muted}/> Back to credit book
      </button>

      <Card style={{padding:isMobile?16:22,marginBottom:16}}>
        <SLabel style={{marginBottom:14}}>{isEdit?"Edit entry":"New entry"}</SLabel>
        <div style={{display:"flex",gap:10,marginBottom:16}}>
          {kindBtn("credit","Credit given",C.red)}
          {kindBtn("payment","Payment received",C.green)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"2fr 1fr 1fr",gap:12}}>
          <div><label style={lbl}>Customer</label>
            <input value={draft.customer} list="hzx-customers" placeholder="e.g. John Deng" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("customer",e.target.value)}/></div>
          <div><label style={lbl}>Phone (optional)</label>
            <input value={draft.phone} placeholder="09xx…" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("phone",e.target.value)}/></div>
          <div><label style={lbl}>Date</label>
            <input type="date" value={draft.date} style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("date",e.target.value)}/></div>
        </div>
      </Card>

      {isCredit && (
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <SLabel>What they took (optional)</SLabel>
            <span style={{fontSize:12,color:C.muted}}>{draft.items.length} row{draft.items.length===1?"":"s"}</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {draft.items.map((it,idx)=>{
              const line=nv(it.qty)*nv(it.price);
              return(
                <Card key={it.id} style={{padding:16}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                    <span style={{width:24,height:24,borderRadius:6,background:C.tealBg,color:C.teal,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{idx+1}</span>
                    <input value={it.name} list="hzx-products" placeholder="Item taken (e.g. Tusker)" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>pickName(it.id,e.target.value)}/>
                    <button onClick={()=>removeItem(it.id)} title="Remove" style={{background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:6,padding:8,cursor:"pointer",display:"flex",flexShrink:0}}>
                      <Ico d={IC.trash} size={15} color={C.red}/>
                    </button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                    <div><label style={lbl}>Qty</label>
                      <input type="number" inputMode="decimal" value={it.qty} placeholder="0" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setItem(it.id,"qty",e.target.value)}/></div>
                    <div><label style={lbl}>Price / piece</label>
                      <input type="number" inputMode="decimal" value={it.price} placeholder="0" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setItem(it.id,"price",e.target.value)}/></div>
                    <div style={{background:C.inputBg,borderRadius:8,padding:"8px 10px",alignSelf:"end"}}>
                      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Line total</div>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(line)}</div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <button onClick={addItem} style={{marginTop:12,width:"100%",background:C.tealBg,border:`1px dashed ${C.teal}66`,borderRadius:10,color:C.teal,padding:"12px",fontWeight:600,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <Ico d={IC.add} size={16} color={C.teal}/> Add another item
          </button>
        </>
      )}

      {/* amount + note */}
      <Card style={{padding:isMobile?16:22,marginTop:16}}>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 2fr",gap:12}}>
          <div>
            <label style={lbl}>{isCredit?"Amount owed (SSP)":"Amount received (SSP)"}</label>
            {isCredit&&hasItems
              ? <div style={{...mkINP(C),fontWeight:700,fontSize:16,display:"flex",alignItems:"center"}}>{fmt(itemsAmount)} <span style={{fontSize:10,color:C.muted,marginLeft:8}}>from items</span></div>
              : <input type="number" inputMode="decimal" value={draft.amount} placeholder="0" style={{...mkINP(C),fontWeight:700,fontSize:16}} onFocus={focus} onBlur={blur} onChange={e=>setField("amount",e.target.value)}/>}
          </div>
          <div><label style={lbl}>Note (optional)</label>
            <input value={draft.note} placeholder={isCredit?"e.g. promised to pay Friday":"e.g. part payment"} style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setField("note",e.target.value)}/></div>
        </div>
      </Card>

      {error&&(
        <div style={{marginTop:14,padding:"10px 14px",background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:8,fontSize:12,color:C.red,display:"flex",alignItems:"center",gap:8}}>
          <Ico d={IC.alert} size={15} color={C.red}/> {error}
        </div>
      )}

      {/* sticky save bar */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.header,borderTop:`1px solid ${C.cardB}`,zIndex:20}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:isMobile?"10px 14px":"12px 28px",display:"flex",alignItems:"center",gap:16}}>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:C.muted}}>{isCredit?"Credit to "+(draft.customer.trim()||"customer"):"Payment from "+(draft.customer.trim()||"customer")}</div>
            <div style={{fontSize:16,fontWeight:700,color:isCredit?C.red:C.green,fontVariantNumeric:"tabular-nums"}}>{isCredit?"+":"−"}{fmt(amount)} SSP</div>
          </div>
          <button onClick={onCancel} disabled={busy} style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"10px 16px",fontSize:13,cursor:"pointer",opacity:busy?0.5:1}}>Cancel</button>
          <button onClick={save} disabled={busy} style={{background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"10px 20px",fontWeight:700,fontSize:13,cursor:busy?"not-allowed":"pointer",opacity:busy?0.7:1,display:"flex",alignItems:"center",gap:8}}>
            <Ico d={IC.check} size={16} color="#09111e"/> {busy?"Saving…":isEdit?"Save changes":"Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── STOCK LEVELS (live inventory) ─────────────────────────────────────────────
const STATUS_CFG = (C) => ({
  out: { label:"Out of stock", color:C.red,    bg:"rgba(240,82,82,0.12)" },
  low: { label:"Low",          color:C.orange, bg:"rgba(249,115,22,0.12)" },
  ok:  { label:"In stock",     color:C.green,  bg:"rgba(16,185,129,0.12)" },
});
function StockLevels({batches, dailies, user, onAddStock}){
  const C=useTheme();
  const rows=stockLevels(batches, dailies);
  const SC=STATUS_CFG(C);
  const out=rows.filter(r=>r.status==="out").length;
  const low=rows.filter(r=>r.status==="low").length;

  if(rows.length===0){
    return(
      <div style={{textAlign:"center",maxWidth:440,margin:"60px auto",padding:"0 20px"}}>
        <div style={{width:60,height:60,borderRadius:16,background:C.tealBg,border:`1px solid ${C.teal}44`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px"}}>
          <Ico d={IC.box} size={26} color={C.teal}/>
        </div>
        <div style={{fontSize:18,fontWeight:700,color:C.text}}>No stock yet</div>
        <div style={{fontSize:13,color:C.muted,marginTop:6,lineHeight:1.6}}>Add stock you bought, then as you record daily sales this page shows what's left and warns you when an item is running low.</div>
        {canDo(user,"canEdit")&&(
          <button onClick={onAddStock} style={{marginTop:18,background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"11px 20px",fontWeight:700,fontSize:13,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8}}>
            <Ico d={IC.add} size={16} color="#09111e"/> Add stock
          </button>
        )}
      </div>
    );
  }

  return(
    <div>
      {/* low-stock warning banner */}
      {(out+low)>0 && (
        <Card style={{padding:"14px 18px",marginBottom:16,border:`1px solid ${C.orange}55`,background:"rgba(249,115,22,0.08)",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <Ico d={IC.alert} size={20} color={C.orange}/>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:14,fontWeight:700,color:C.text}}>Restock needed</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>
              {out>0 && <span style={{color:C.red,fontWeight:600}}>{out} out of stock</span>}
              {out>0 && low>0 && " · "}
              {low>0 && <span style={{color:C.orange,fontWeight:600}}>{low} running low</span>}
              {" — "}{rows.filter(r=>r.status!=="ok").slice(0,4).map(r=>r.name).join(", ")}{rows.filter(r=>r.status!=="ok").length>4?"…":""}
            </div>
          </div>
          {canDo(user,"canEdit")&&(
            <button onClick={onAddStock} style={{background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"9px 16px",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:7,flexShrink:0}}>
              <Ico d={IC.add} size={15} color="#09111e"/> Add stock
            </button>
          )}
        </Card>
      )}

      <SLabel style={{marginBottom:12}}>Stock on hand · {rows.length} item{rows.length===1?"":"s"}</SLabel>
      <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",border:`1px solid ${C.cardB}`,borderRadius:12,background:C.card}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:640}}>
          <thead>
            <tr style={{background:C.inputBg}}>
              {[["Item",0],["Bought",1],["Sold",1],["Remaining",1],["Status",0]].map(([h,r],i)=>(
                <th key={i} style={{textAlign:r?"right":"left",fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",color:C.muted,fontWeight:600,padding:"11px 14px",borderBottom:`1px solid ${C.cardB}`,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r=>{
              const s=SC[r.status];
              const tdN={padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,textAlign:"right",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap",fontWeight:600,fontSize:13};
              return(
                <tr key={r.name}>
                  <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,fontWeight:700,color:C.text,fontSize:13,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</td>
                  <td style={{...tdN,color:C.muted,fontWeight:400}}>{fmt(r.bought)}</td>
                  <td style={{...tdN,color:C.muted,fontWeight:400}}>{fmt(r.sold)}</td>
                  <td style={{...tdN,color:s.color,fontWeight:700}}>{fmt(r.remaining)}{r.perUnit>0&&r.status!=="out"?<span style={{fontSize:10,color:C.muted,fontWeight:400}}> pcs</span>:""}</td>
                  <td style={{padding:"10px 14px",borderBottom:`1px solid ${C.divider}`,whiteSpace:"nowrap"}}>
                    <span style={{fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:20,background:s.bg,color:s.color}}>
                      {r.status==="low"?`Low · ${fmt(r.remaining)} left`:s.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:11,color:C.muted,marginTop:10,lineHeight:1.6}}>
        Remaining = pieces bought in stock − pieces sold in daily sales. "Low" means less than one carton left.
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginScreen({onLogin, isDark, setIsDark}){
  const C=isDark?DARK:LIGHT; const isMobile=useIsMobile();
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [showPw,setShowPw]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState("");

  async function doLogin(e){
    e.preventDefault();
    if(!email.trim()){ setError("Please enter your email."); return; }
    if(!password.trim()){ setError("Please enter your password."); return; }
    setLoading(true); setError("");
    try{
      const rows=await auth.login(email.trim().toLowerCase(),password);
      if(!rows||rows.length===0){ setError("Invalid email or password. Please try again."); return; }
      saveSession(rows[0]); onLogin(rows[0]);
    }catch(err){
      const m=String(err&&err.message||"");
      if(/app_users/i.test(m)&&/(exist|relation|schema cache)/i.test(m)) setError("Login table not found — run schema.sql in your Supabase SQL editor.");
      else if(/Network error|Failed to fetch/i.test(m)) setError("Can't reach the database. Check your internet, or whether the Supabase project is paused in the dashboard.");
      else if(/HTTP 401|HTTP 403|invalid.*key|apikey|jwt/i.test(m)) setError("Supabase key/URL problem — check SUPA_URL and SUPA_KEY at the top of App.jsx.");
      else setError(m ? ("Login failed: "+m.replace(/\s+/g," ").slice(0,160)) : "Connection error. Please check your internet and try again.");
    }
    finally{ setLoading(false); }
  }

  return(
    <ThemeCtx.Provider value={C}>
    <div style={{minHeight:"100vh",background:C.pageBg,fontFamily:"'Inter',system-ui,sans-serif",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <style>{`@keyframes _spin{to{transform:rotate(360deg)}} *{box-sizing:border-box}`}</style>
      <button onClick={()=>setIsDark(d=>!d)} style={{position:"fixed",top:16,right:16,width:34,height:34,borderRadius:"50%",background:isDark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)",border:`1px solid ${C.cardB}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {isDark
          ?<svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
          :<svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>}
      </button>
      <div style={{width:"100%",maxWidth:isMobile?"100%":420}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{width:60,height:60,borderRadius:16,background:"linear-gradient(135deg,#003d35,#00594f)",border:`1px solid ${C.teal}44`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
            <Ico d={IC.beer} size={26} color={C.teal}/>
          </div>
          <div style={{fontSize:22,fontWeight:800,color:C.text,letterSpacing:"-0.02em"}}>HOTZONEX <span style={{color:C.teal}}>Stock</span></div>
          <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:"0.12em",marginTop:4}}>Refreshment Centre · Buying &amp; Profit</div>
        </div>
        <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.cardB}`,padding:isMobile?"20px 16px 18px":"32px 32px 28px",boxShadow:isDark?"0 20px 60px rgba(0,0,0,0.5)":"0 8px 32px rgba(0,0,0,0.1)"}}>
          <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:4}}>Sign in</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:24}}>Enter your credentials to access the stock tracker</div>
          <form onSubmit={doLogin}>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:11,color:C.muted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"}}>Email Address</label>
              <input type="email" value={email} autoFocus placeholder="you@hotzonex.com" onChange={e=>{setEmail(e.target.value);setError("");}}
                style={{...mkINP(C)}} onFocus={e=>e.target.style.borderColor=C.teal} onBlur={e=>e.target.style.borderColor=C.cardB}/>
            </div>
            <div style={{marginBottom:24}}>
              <label style={{fontSize:11,color:C.muted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"}}>Password</label>
              <div style={{position:"relative"}}>
                <input type={showPw?"text":"password"} value={password} placeholder="Enter your password" onChange={e=>{setPassword(e.target.value);setError("");}}
                  style={{...mkINP(C),paddingRight:44}} onFocus={e=>e.target.style.borderColor=C.teal} onBlur={e=>e.target.style.borderColor=C.cardB}/>
                <button type="button" onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,padding:2}}>
                  {showPw
                    ?<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>
                    :<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
            </div>
            {error&&(
              <div style={{marginBottom:16,padding:"10px 14px",background:"rgba(240,82,82,0.1)",border:"1px solid rgba(240,82,82,0.3)",borderRadius:8,fontSize:12,color:C.red,display:"flex",alignItems:"center",gap:8}}>
                <Ico d={IC.alert} size={14} color={C.red}/> {error}
              </div>
            )}
            <button type="submit" disabled={loading} style={{width:"100%",background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"13px 20px",fontWeight:700,fontSize:14,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              {loading?<><div style={{width:15,height:15,border:"2px solid rgba(9,17,30,0.3)",borderTop:"2px solid #09111e",borderRadius:"50%",animation:"_spin 0.7s linear infinite"}}/> Signing in…</>:"Sign in"}
            </button>
          </form>
        </div>
        <div style={{textAlign:"center",fontSize:11,color:C.muted,marginTop:16}}>Hotzonex Refreshment Centre · Stock</div>
      </div>
    </div>
    </ThemeCtx.Provider>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [isDark,setIsDark]=useState(true);
  const [user,setUser]=useState(()=>loadSession());
  if(!user) return <LoginScreen onLogin={setUser} isDark={isDark} setIsDark={setIsDark}/>;
  return <MainApp user={user} onLogout={()=>{clearSession();setUser(null);}} isDark={isDark} setIsDark={setIsDark}/>;
}

function MainApp({user, onLogout, isDark, setIsDark}){
  const C=isDark?DARK:LIGHT;
  const isMobile=useIsMobile();
  const [view,setView]=useState("home");           // home | daily | dailyEntry | credit | creditEntry | dashboard | entry | reports
  const [editing,setEditing]=useState(null);        // stock batch being edited
  const [editingDaily,setEditingDaily]=useState(null);
  const [editingCredit,setEditingCredit]=useState(null);
  const [creditPreset,setCreditPreset]=useState(null);  // {customer,phone,kind} for a new entry
  const [openCustomer,setOpenCustomer]=useState(null);  // customer name → detail modal
  const [editCustomer,setEditCustomer]=useState(null);  // customer obj → edit name/phone modal
  const [batches,setBatches]=useState(null);        // null = loading
  const [dailies,setDailies]=useState(null);        // null = loading
  const [credits,setCredits]=useState(null);        // null = loading
  const [toDelete,setToDelete]=useState(null);      // {kind:'stock'|'daily'|'credit', row}
  const [toast,setToast]=useState("");
  const [report,setReport]=useState(null);   // {type:'batch'|'summary', batch?}
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const roleCfg=ROLES[user.role]||ROLES.viewer;

  useEffect(()=>{ stockDb.fetchAll().then(setBatches).catch(e=>{ console.error(e); setBatches([]);
    const m=String(e&&e.message||"");
    setToast(/stock_batches/i.test(m)&&/(exist|relation|schema cache)/i.test(m) ? "stock_batches table missing — run schema.sql" : "Could not load stock: "+m.slice(0,80));
  }); },[]);
  useEffect(()=>{ dailyDb.fetchAll().then(setDailies).catch(e=>{ console.error(e); setDailies([]);
    const m=String(e&&e.message||"");
    setToast(/daily_sales/i.test(m)&&/(exist|relation|schema cache)/i.test(m) ? "daily_sales table missing — create it in Supabase" : "Could not load daily sales: "+m.slice(0,80));
  }); },[]);
  useEffect(()=>{ creditDb.fetchAll().then(setCredits).catch(e=>{ console.error(e); setCredits([]);
    const m=String(e&&e.message||"");
    setToast(/credit_entries/i.test(m)&&/(exist|relation|schema cache)/i.test(m) ? "credit_entries table missing — create it in Supabase" : "Could not load credit book: "+m.slice(0,80));
  }); },[]);
  const flash=m=>{ setToast(m); setTimeout(()=>setToast(""),2400); };
  const products=React.useMemo(()=>productsFromBatches(batches),[batches]);
  const customers=React.useMemo(()=>customersFromEntries(credits),[credits]);
  const stock=React.useMemo(()=>{ const m=new Map(); stockLevels(batches,dailies).forEach(r=>m.set(normKey(r.name),r)); return m; },[batches,dailies]);

  const navTo=id=>{ setView(id); if(id==="entry") setEditing(null); if(id==="dailyEntry") setEditingDaily(null);
    if(id==="creditEntry"){ setEditingCredit(null); setCreditPreset(null); } if(isMobile) setSidebarOpen(false); };

  // ── stock batches ──
  const startEdit=b=>{ setEditing(b); setView("entry"); };
  const onSaved=row=>{
    setBatches(prev=>{ const list=prev||[]; const exists=list.some(b=>b.id===row.id);
      const next=exists?list.map(b=>b.id===row.id?row:b):[row,...list];
      return [...next].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))); });
    flash(editing?"Stock updated":"Stock saved"); setView("dashboard"); setEditing(null);
  };

  // ── daily sales ──
  const startEditDaily=d=>{ setEditingDaily(d); setView("dailyEntry"); };
  const onSavedDaily=(row, creditDelta)=>{
    setDailies(prev=>{ const list=prev||[]; const exists=list.some(d=>d.id===row.id);
      const next=exists?list.map(d=>d.id===row.id?row:d):[row,...list];
      return [...next].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))); });
    if(creditDelta){
      const removed=new Set(creditDelta.removedIds||[]);
      setCredits(prev=>{ const kept=(prev||[]).filter(e=>!removed.has(e.id));
        return [...(creditDelta.added||[]), ...kept].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))); });
    }
    flash(editingDaily?"Day updated":"Sales saved"); setView("daily"); setEditingDaily(null);
  };

  // ── credit book ──
  const giveCredit=(preset)=>{ setCreditPreset(preset||{kind:"credit"}); setEditingCredit(null); setOpenCustomer(null); setView("creditEntry"); };
  const startEditCredit=e=>{ setEditingCredit(e); setCreditPreset(null); setOpenCustomer(null); setView("creditEntry"); };
  const onSavedCredit=row=>{
    setCredits(prev=>{ const list=prev||[]; const exists=list.some(e=>e.id===row.id);
      const next=exists?list.map(e=>e.id===row.id?row:e):[row,...list];
      return [...next].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))); });
    flash(editingCredit?"Entry updated":(row.kind==="payment"?"Payment recorded":"Credit recorded"));
    setView("credit"); setEditingCredit(null); setCreditPreset(null);
  };
  const entryIdsFor=name=>(credits||[]).filter(e=>normKey(e.customer)===normKey(name)).map(e=>e.id);
  async function saveCustomer(oldName, newName, newPhone){
    const ids=entryIdsFor(oldName); const phone=newPhone||null;
    await Promise.all(ids.map(id=>creditDb.patch(id,{customer:newName, phone})));
    setCredits(prev=>(prev||[]).map(e=>ids.includes(e.id)?{...e,customer:newName,phone}:e));
    setEditCustomer(null);
    if(openCustomer && normKey(openCustomer)===normKey(oldName)) setOpenCustomer(newName);
    flash("Customer updated");
  }

  async function confirmDelete(){
    const t=toDelete; setToDelete(null); if(!t) return;
    try{
      if(t.kind==="daily"){
        await dailyDb.remove(t.row.id);
        const linkedIds=(credits||[]).filter(e=>e.daily_id===t.row.id).map(e=>e.id);  // credit lines that came from this day
        await Promise.all(linkedIds.map(id=>creditDb.remove(id)));
        setDailies(prev=>(prev||[]).filter(d=>d.id!==t.row.id));
        if(linkedIds.length) setCredits(prev=>(prev||[]).filter(e=>!linkedIds.includes(e.id)));
        flash("Day deleted");
      }
      else if(t.kind==="credit"){ await creditDb.remove(t.row.id); setCredits(prev=>(prev||[]).filter(e=>e.id!==t.row.id)); flash("Entry deleted"); }
      else if(t.kind==="customer"){
        const ids=entryIdsFor(t.row.name);
        await Promise.all(ids.map(id=>creditDb.remove(id)));
        setCredits(prev=>(prev||[]).filter(e=>!ids.includes(e.id)));
        if(openCustomer && normKey(openCustomer)===normKey(t.row.name)) setOpenCustomer(null);
        flash("Customer removed");
      }
      else { await stockDb.remove(t.row.id); setBatches(prev=>(prev||[]).filter(b=>b.id!==t.row.id)); flash("Stock deleted"); }
    }catch(e){ console.error(e); flash("Could not delete"); }
  }

  const NAV=[{id:"home",label:"Dashboard",icon:"dashboard"}];
  NAV.push({id:"daily",label:"Daily Sales",icon:"cash"});
  if(canDo(user,"canEdit")) NAV.push({id:"dailyEntry",label:"Record Day",icon:"calendar"});
  NAV.push({id:"credit",label:"Credit Book",icon:"people"});
  NAV.push({id:"levels",label:"Stock Levels",icon:"box"});
  NAV.push({id:"dashboard",label:"Stock & Profit",icon:"wallet"});
  if(canDo(user,"canEdit")) NAV.push({id:"entry",label:"Add Stock",icon:"add"});
  NAV.push({id:"reports",label:"Reports",icon:"print"});
  const creditTitle=editingCredit?"Edit Entry":(creditPreset?.kind==="payment"?"Record Payment":"Give Credit");
  const TITLES={home:"Business Overview",daily:"Daily Sales",dailyEntry:editingDaily?"Edit Day":"Record Day",credit:"Credit Book",creditEntry:creditTitle,levels:"Stock Levels",dashboard:"Stock & Profit",entry:editing?"Edit Stock":"Add Stock",reports:"Reports & Printing"};
  const loading = batches===null || dailies===null || credits===null;

  return(
    <ThemeCtx.Provider value={C}>
    <div style={{minHeight:"100vh",background:C.pageBg,fontFamily:"'Inter',system-ui,sans-serif",color:C.text,display:"flex",flexDirection:"column"}}>
      <style>{`@keyframes _spin{to{transform:rotate(360deg)}} *{-webkit-tap-highlight-color:transparent;box-sizing:border-box} input[type=number]::-webkit-inner-spin-button{opacity:0.4}`}</style>

      {/* HEADER */}
      <div style={{background:C.header,display:"flex",alignItems:"center",padding:isMobile?"0 12px":"0 20px",height:60,position:"sticky",top:0,zIndex:30,flexShrink:0,gap:8,borderBottom:`1px solid ${C.cardB}`}}>
        {isMobile&&(
          <button onClick={()=>setSidebarOpen(o=>!o)} style={{background:"transparent",border:"none",cursor:"pointer",color:C.muted,padding:6,display:"flex",flexShrink:0}}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={sidebarOpen?"M18 6L6 18M6 6l12 12":"M3 12h18M3 6h18M3 18h18"}/></svg>
          </button>
        )}
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#003d35,#00594f)",border:`1px solid ${C.teal}44`,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Ico d={IC.beer} size={15} color={C.teal}/>
          </div>
          {!isMobile&&(
            <div>
              <div style={{fontSize:13,fontWeight:800,letterSpacing:"-0.01em",lineHeight:1}}>HOTZONEX <span style={{color:C.teal}}>Stock</span></div>
              <div style={{fontSize:8,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginTop:1}}>Refreshment Centre</div>
            </div>
          )}
        </div>
        {isMobile&&<div style={{flex:1,textAlign:"center",fontSize:13,fontWeight:700,color:C.text}}>{TITLES[view]}</div>}
        {!isMobile&&<div style={{flex:1}}/>}
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <button onClick={()=>setIsDark(d=>!d)} style={{width:30,height:30,borderRadius:"50%",background:"transparent",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            {isDark
              ?<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
              :<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>}
          </button>
          <div style={{width:30,height:30,borderRadius:"50%",background:roleCfg.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#09111e",flexShrink:0}} title={`${user.name} · ${roleCfg.label}`}>
            {(user.name||"?").charAt(0).toUpperCase()}
          </div>
          <button onClick={onLogout} title="Sign out" style={{background:"transparent",border:"none",cursor:"pointer",color:C.muted,padding:4,display:"flex"}}>
            <Ico d={IC.logout} size={15} color={C.muted}/>
          </button>
        </div>
      </div>

      {/* BODY */}
      <div style={{display:"flex",flex:1,minHeight:0,position:"relative"}}>
        {isMobile&&sidebarOpen&&<div onClick={()=>setSidebarOpen(false)} style={{position:"fixed",inset:0,top:60,background:"rgba(0,0,0,0.5)",zIndex:25}}/>}

        {/* Sidebar */}
        <div style={{width:210,flexShrink:0,background:C.sidebar,borderRight:`1px solid ${C.cardB}`,overflowY:"auto",
          ...(isMobile?{position:"fixed",top:60,left:0,height:"calc(100vh - 60px)",zIndex:26,transform:sidebarOpen?"translateX(0)":"translateX(-100%)",transition:"transform 0.25s ease"}
                     :{position:"sticky",top:60,height:"calc(100vh - 60px)"})}}>
          <div style={{padding:"12px 16px",background:`rgba(${hexToRgb(roleCfg.color)},0.06)`}}>
            <div style={{fontSize:11,fontWeight:700,color:C.text}}>{user.name}</div>
            <span style={{fontSize:10,padding:"1px 7px",borderRadius:20,fontWeight:600,background:`rgba(${hexToRgb(roleCfg.color)},0.15)`,color:roleCfg.color,marginTop:4,display:"inline-block"}}>{roleCfg.label}</span>
          </div>
          <div style={{padding:"10px 0"}}>
            {NAV.map(item=>{ const active=view===item.id;
              return(
                <button key={item.id} onClick={()=>navTo(item.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"11px 18px",
                  background:active?C.tealBg:"transparent",borderStyle:"solid",borderWidth:"0 0 0 3px",borderColor:active?C.teal:"transparent",outline:"none",
                  color:active?C.teal:C.muted,cursor:"pointer",fontSize:13,fontWeight:active?600:400,textAlign:"left"}}>
                  <Ico d={IC[item.icon]} size={16} color={active?C.teal:C.muted}/> {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main */}
        <div style={{flex:1,overflowY:"auto",padding:isMobile?"16px 14px":"24px 28px",minWidth:0}}>
          {!isMobile&&(
            <div style={{marginBottom:20}}>
              <h1 style={{margin:0,fontSize:22,fontWeight:700,color:C.text,letterSpacing:"-0.02em"}}>{TITLES[view]}</h1>
              <div style={{fontSize:12,color:C.muted,marginTop:3}}>Hotzonex Refreshment Centre · all amounts in SSP</div>
            </div>
          )}
          <ErrorBoundary theme={C}>
            {loading
              ? <Loading/>
              : view==="home"
                ? <Overview batches={batches} dailies={dailies} credits={credits} user={user} onGoto={navTo} onGiveCredit={giveCredit} onOpenCustomer={setOpenCustomer}/>
              : view==="daily"
                ? <DailySales dailies={dailies} credits={credits} user={user} onEdit={startEditDaily} onDelete={d=>setToDelete({kind:"daily",row:d})} onNew={()=>navTo("dailyEntry")}/>
              : view==="dailyEntry"
                ? canDo(user,"canEdit")
                  ? <DailyEntry key={editingDaily?editingDaily.id:"new-daily"} initial={editingDaily} products={products} customers={customers} stock={stock} linkedCredits={editingDaily?(credits||[]).filter(e=>e.daily_id===editingDaily.id && e.kind!=="payment"):[]} onSaved={onSavedDaily} onCancel={()=>{setView("daily");setEditingDaily(null);}}/>
                  : <div style={{color:C.muted,padding:40,textAlign:"center",fontSize:13}}>You don't have permission to record sales.</div>
              : view==="credit"
                ? <CreditBook entries={credits} user={user} onGiveCredit={giveCredit} onOpenCustomer={setOpenCustomer} onEditCustomer={setEditCustomer} onDeleteCustomer={c=>setToDelete({kind:"customer",row:c})}/>
              : view==="creditEntry"
                ? canDo(user,"canEdit")
                  ? <CreditEntry key={editingCredit?editingCredit.id:"new-credit"} initial={editingCredit} preset={creditPreset} products={products} customers={customers} onSaved={onSavedCredit} onCancel={()=>{setView("credit");setEditingCredit(null);setCreditPreset(null);}}/>
                  : <div style={{color:C.muted,padding:40,textAlign:"center",fontSize:13}}>You don't have permission to record credit.</div>
              : view==="levels"
                ? <StockLevels batches={batches} dailies={dailies} user={user} onAddStock={()=>navTo("entry")}/>
              : view==="dashboard"
                ? <Dashboard batches={batches} user={user} onEdit={startEdit} onDelete={b=>setToDelete({kind:"stock",row:b})} onNew={()=>navTo("entry")} onPrint={b=>setReport({type:"batch",batch:b})}/>
              : view==="reports"
                ? <ReportsView batches={batches} onPrintBatch={b=>setReport({type:"batch",batch:b})} onPrintSummary={()=>setReport({type:"summary"})}/>
              : canDo(user,"canEdit")
                ? <StockEntry key={editing?editing.id:"new"} initial={editing} onSaved={onSaved} onCancel={()=>{setView("dashboard");setEditing(null);}} onPrint={b=>setReport({type:"batch",batch:b})}/>
                : <div style={{color:C.muted,padding:40,textAlign:"center",fontSize:13}}>You don't have permission to enter stock.</div>}
          </ErrorBoundary>
        </div>
      </div>

      {editCustomer&&<EditCustomer customer={editCustomer} onCancel={()=>setEditCustomer(null)} onSave={(nm,ph)=>saveCustomer(editCustomer.name,nm,ph)}/>}
      {openCustomer&&<CustomerDetail name={openCustomer} entries={credits||[]} user={user}
        onClose={()=>setOpenCustomer(null)}
        onGiveCredit={p=>{setOpenCustomer(null);giveCredit(p);}}
        onRecordPayment={p=>{setOpenCustomer(null);giveCredit(p);}}
        onEdit={e=>{setOpenCustomer(null);startEditCredit(e);}}
        onDelete={e=>setToDelete({kind:"credit",row:e})}/>}
      {toDelete&&<ConfirmDelete target={toDelete} onCancel={()=>setToDelete(null)} onConfirm={confirmDelete}/>}
      {report&&<PrintFrame onClose={()=>setReport(null)}>{report.type==="summary"?<SummaryReport batches={batches}/>:<BatchReport batch={report.batch}/>}</PrintFrame>}
      {toast&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:C.card,border:`1px solid ${C.cardB}`,borderRadius:20,padding:"10px 18px",fontSize:13,fontWeight:600,color:C.text,zIndex:60,display:"flex",alignItems:"center",gap:8,boxShadow:"0 8px 24px rgba(0,0,0,0.3)"}}>
          <Ico d={IC.check} size={15} color={C.teal}/> {toast}
        </div>
      )}
    </div>
    </ThemeCtx.Provider>
  );
}

function hexToRgb(hex){ const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `${r},${g},${b}`; }
