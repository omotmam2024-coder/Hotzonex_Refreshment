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
const SUPA_URL = "https://pisogfynqghabbohhyri.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpc29nZnlucWdoYWJib2hoeXJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMjA4NzAsImV4cCI6MjA5Njc5Njg3MH0.AmqoAhA8Xo0KlOJi36JNOnlt64TLx2AQQ8cmIB2HKps";
const H = {
  "Content-Type":"application/json",
  "apikey":SUPA_KEY,
  "Authorization":`Bearer ${SUPA_KEY}`,
  "Prefer":"return=representation",
};
async function sbFetch(path, opts={}) {
  const res = await fetch(`${SUPA_URL}/rest/v1${path}`, { headers:H, ...opts });
  if (!res.ok) throw new Error(await res.text());
  const t = await res.text();
  return t ? JSON.parse(t) : [];
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

// ── Helpers ───────────────────────────────────────────────────────────────────
const nv  = v => Number(v) || 0;
const fmt = v => nv(v).toLocaleString();
const uid = () => Math.random().toString(36).slice(2,9);
const compact = v => { const a=Math.abs(v); return a>=1e6?`${(v/1e6).toFixed(a>=1e7?0:1)}M`:a>=1e3?`${Math.round(v/1e3)}K`:`${v}`; };
const itemCalc = (it) => {
  const totalCost   = nv(it.unitsBought) * nv(it.costPerUnit);
  const totalPieces = nv(it.unitsBought) * nv(it.piecesPerUnit);
  const expectedSales = totalPieces * nv(it.pricePerPiece);
  return { totalCost, totalPieces, expectedSales, profit: expectedSales - totalCost };
};
const batchCalc = (b) => {
  let spent=0, sales=0;
  (b.items||[]).forEach(it=>{ const c=itemCalc(it); spent+=c.totalCost; sales+=c.expectedSales; });
  const profitOnStock = sales - spent;
  const expenses = nv(b.expenses);
  return { spent, sales, profitOnStock, expenses, takeHome: profitOnStock - expenses, margin: sales>0 ? profitOnStock/sales : 0 };
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
  list:"M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  edit:"M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  trash:"M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  logout:"M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  check:"M5 13l4 4L19 7",
  back:"M19 12H5m7 7l-7-7 7-7",
  beer:"M5 8h11v9a3 3 0 01-3 3H8a3 3 0 01-3-3V8zm11 1h2a2 2 0 012 2v2a2 2 0 01-2 2h-2M8 4v2m3-2v2m3-2v2",
  alert:"M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
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
function Dashboard({batches, user, onEdit, onDelete, onNew}){
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

      {/* batch list */}
      <SLabel style={{marginBottom:12}}>Stock Batches</SLabel>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":isTablet?"1fr 1fr":"repeat(3,1fr)",gap:14}}>
        {batches.map(b=>{
          const t=batchCalc(b);
          const dateStr=b.date?new Date(b.date+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"No date";
          return(
            <Card key={b.id} style={{padding:18}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{dateStr} · {b.items.length} items</div>
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
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
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:14}}>
                <div><div style={{fontSize:10,color:C.muted}}>Spent</div><div style={{fontSize:14,fontWeight:600,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(t.spent)}</div></div>
                <div><div style={{fontSize:10,color:C.muted}}>Expected sales</div><div style={{fontSize:14,fontWeight:600,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmt(t.sales)}</div></div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginTop:12,paddingTop:12,borderTop:`1px solid ${C.divider}`}}>
                <div>
                  <div style={{fontSize:10,color:C.muted}}>Take-home profit</div>
                  <div style={{fontSize:18,fontWeight:700,color:t.takeHome>=0?C.green:C.red,fontVariantNumeric:"tabular-nums"}}>{t.takeHome>=0?"+":""}{fmt(t.takeHome)}</div>
                </div>
                <span style={{fontSize:11,padding:"2px 9px",borderRadius:20,fontWeight:600,background:C.tealBg,color:C.teal}}>{(t.margin*100).toFixed(1)}%</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── STOCK ENTRY ───────────────────────────────────────────────────────────────
const blankItem = () => ({ id:uid(), name:"", unitsBought:"", costPerUnit:"", piecesPerUnit:"", pricePerPiece:"" });
const toDraft = (b) => b
  ? { id:b.id, name:b.name, date:b.date||"", expenses:String(b.expenses??""),
      items:(b.items||[]).map(it=>({ id:it.id||uid(), name:it.name,
        unitsBought:String(it.unitsBought??""), costPerUnit:String(it.costPerUnit??""),
        piecesPerUnit:String(it.piecesPerUnit??""), pricePerPiece:String(it.pricePerPiece??"") })) }
  : { id:null, name:"", date:new Date().toISOString().slice(0,10), expenses:"", items:[blankItem()] };

function StockEntry({initial, onSaved, onCancel}){
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
    const payload={ name:draft.name.trim()||draft.date, date:draft.date||null, expenses:nv(draft.expenses), items };
    try{
      const rows = isEdit ? await stockDb.patch(draft.id,payload) : await stockDb.insert(payload);
      onSaved(rows && rows[0] ? rows[0] : { ...payload, id:draft.id||uid() });
    }catch(e){ console.error(e); setError("Could not save — check your connection and try again."); setBusy(false); }
  }

  const lbl={fontSize:11,color:C.muted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"};
  const focus=e=>e.target.style.borderColor=C.teal, blur=e=>e.target.style.borderColor=C.cardB;

  return(
    <div style={{paddingBottom:90}}>
      <button onClick={onCancel} style={{display:"inline-flex",alignItems:"center",gap:6,background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:13,marginBottom:14}}>
        <Ico d={IC.back} size={15} color={C.muted}/> Back to dashboard
      </button>

      {/* batch details */}
      <Card style={{padding:isMobile?16:22,marginBottom:16}}>
        <SLabel style={{marginBottom:14}}>{isEdit?"Edit stock":"New stock"}</SLabel>
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
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:10}}>
                {[["Units bought","unitsBought"],["Cost per unit","costPerUnit"],["Pieces per unit","piecesPerUnit"],["Sell price / piece","pricePerPiece"]].map(([label,key])=>(
                  <div key={key}><label style={lbl}>{label}</label>
                    <input type="number" value={it[key]} placeholder="0" style={mkINP(C)} onFocus={focus} onBlur={blur} onChange={e=>setItem(it.id,key,e.target.value)}/></div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:12}}>
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
          <button onClick={onCancel} disabled={busy} style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"10px 16px",fontSize:13,cursor:"pointer",opacity:busy?0.5:1}}>Cancel</button>
          <button onClick={save} disabled={busy} style={{background:C.teal,border:"none",borderRadius:8,color:"#09111e",padding:"10px 20px",fontWeight:700,fontSize:13,cursor:busy?"not-allowed":"pointer",opacity:busy?0.7:1,display:"flex",alignItems:"center",gap:8}}>
            <Ico d={IC.check} size={16} color="#09111e"/> {busy?"Saving…":isEdit?"Save changes":"Save stock"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm delete ────────────────────────────────────────────────────────────
function ConfirmDelete({batch,onCancel,onConfirm}){
  const C=useTheme();
  return(
    <div onClick={onCancel} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.cardB}`,borderRadius:12,padding:24,maxWidth:380,width:"100%"}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text}}>Delete this stock?</div>
        <div style={{fontSize:13,color:C.muted,marginTop:8,lineHeight:1.6}}>
          <strong style={{color:C.text}}>{batch.name}</strong> and its {batch.items.length} items will be removed. This can't be undone.
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20}}>
          <button onClick={onCancel} style={{background:"transparent",border:`1px solid ${C.cardB}`,borderRadius:8,color:C.text,padding:"9px 16px",fontSize:13,cursor:"pointer"}}>Keep it</button>
          <button onClick={onConfirm} style={{background:C.red,border:"none",borderRadius:8,color:"#fff",padding:"9px 16px",fontWeight:700,fontSize:13,cursor:"pointer"}}>Delete</button>
        </div>
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
    }catch(err){ setError("Connection error. Please check your internet and try again."); }
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
  const [view,setView]=useState("dashboard");      // dashboard | entry
  const [editing,setEditing]=useState(null);
  const [batches,setBatches]=useState(null);        // null = loading
  const [toDelete,setToDelete]=useState(null);
  const [toast,setToast]=useState("");
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const roleCfg=ROLES[user.role]||ROLES.viewer;

  useEffect(()=>{ stockDb.fetchAll().then(setBatches).catch(e=>{ console.error(e); setBatches([]); setToast("Could not load stock"); }); },[]);
  const flash=m=>{ setToast(m); setTimeout(()=>setToast(""),2400); };

  const navTo=id=>{ setView(id); if(id==="entry") setEditing(null); if(isMobile) setSidebarOpen(false); };
  const startEdit=b=>{ setEditing(b); setView("entry"); };
  const onSaved=row=>{
    setBatches(prev=>{ const list=prev||[]; const exists=list.some(b=>b.id===row.id);
      const next=exists?list.map(b=>b.id===row.id?row:b):[row,...list];
      return [...next].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))); });
    flash(editing?"Stock updated":"Stock saved"); setView("dashboard"); setEditing(null);
  };
  async function confirmDelete(){
    const t=toDelete; setToDelete(null);
    try{ await stockDb.remove(t.id); setBatches(prev=>(prev||[]).filter(b=>b.id!==t.id)); flash("Stock deleted"); }
    catch(e){ console.error(e); flash("Could not delete"); }
  }

  const NAV=[{id:"dashboard",label:"Dashboard",icon:"dashboard"}];
  if(canDo(user,"canEdit")) NAV.push({id:"entry",label:"Add Stock",icon:"add"});
  const TITLES={dashboard:"Business Overview",entry:editing?"Edit Stock":"Add Stock"};

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
                  background:active?C.tealBg:"transparent",borderLeft:`3px solid ${active?C.teal:"transparent"}`,border:"none",outline:"none",
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
            {batches===null
              ? <Loading/>
              : view==="dashboard"
                ? <Dashboard batches={batches} user={user} onEdit={startEdit} onDelete={setToDelete} onNew={()=>navTo("entry")}/>
                : canDo(user,"canEdit")
                  ? <StockEntry key={editing?editing.id:"new"} initial={editing} onSaved={onSaved} onCancel={()=>{setView("dashboard");setEditing(null);}}/>
                  : <div style={{color:C.muted,padding:40,textAlign:"center",fontSize:13}}>You don't have permission to enter stock.</div>}
          </ErrorBoundary>
        </div>
      </div>

      {toDelete&&<ConfirmDelete batch={toDelete} onCancel={()=>setToDelete(null)} onConfirm={confirmDelete}/>}
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
