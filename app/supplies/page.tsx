'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

type Company = { id: string; code: string; name: string; next_reorder_date: string | null; alert_days_before: number }
type Item = { id: string; name: string; category: string; unit: string; company_id: string; supplier: string | null; ea_per_unit: number | null }
type Order = { id: string; item_id: string; order_date: string; quantity: number; unit_price: number | null; total_cost: number | null; invoice_ref: string | null; status: string; consumed: boolean }
type TabType = 'DASHBOARD' | 'AFS' | 'TNT' | 'ZFS' | 'SETTINGS'

const COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#F97316','#14B8A6','#EC4899','#6366F1']
const fmt = (v: number) => `$${v.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}`

function OrderFormFields({draft,setDraft,items,getCode}:{draft:any,setDraft:any,items:Item[],getCode:(id:string)=>string}) {
  return (
    <>
      <div>
        <label className="text-xs text-gray-600 mb-1 block">품목</label>
        <select value={draft.item_id} onChange={e=>setDraft((d:any)=>({...d,item_id:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" required>
          <option value="">— 선택 —</option>
          {items.map(item=><option key={item.id} value={item.id}>[{getCode(item.company_id)}] {item.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 mb-1 block">주문일</label>
          <input type="date" value={draft.order_date} onChange={e=>setDraft((d:any)=>({...d,order_date:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" required/></div>
        <div><label className="text-xs text-gray-600 mb-1 block">수량</label>
          <input type="number" value={draft.quantity} onChange={e=>setDraft((d:any)=>({...d,quantity:Number(e.target.value)}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" min="1" required/></div>
        <div><label className="text-xs text-gray-600 mb-1 block">단가 (선택)</label>
          <input type="number" value={draft.unit_price} onChange={e=>setDraft((d:any)=>({...d,unit_price:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" step="0.01"/></div>
        <div><label className="text-xs text-gray-600 mb-1 block">인보이스 번호</label>
          <input type="text" value={draft.invoice_ref} onChange={e=>setDraft((d:any)=>({...d,invoice_ref:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/></div>
      </div>
    </>
  )
}

const emptyDraft = () => ({item_id:'',order_date:new Date().toISOString().split('T')[0],quantity:1,unit_price:'',invoice_ref:''})
const emptyItemDraft = () => ({name:'',category:'Coffee',unit:'bag',supplier:'',ea_per_unit:'',company_id:''})

export default function SuppliesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [tab, setTab] = useState<TabType>('DASHBOARD')
  const currentYear = String(new Date().getFullYear())
  const [dashYear, setDashYear] = useState(currentYear)
  const [dashCo, setDashCo] = useState('ALL')
  const [expandedInvoice, setExpandedInvoice] = useState<string|null>(null)
  const [settingsDraft, setSettingsDraft] = useState<Record<string,{next_reorder_date:string;alert_days_before:number}>>({})

  // 주문 모달
  const [showAdd, setShowAdd] = useState(false)
  const [addDraft, setAddDraft] = useState(emptyDraft())
  const [editingOrder, setEditingOrder] = useState<Order|null>(null)
  const [editDraft, setEditDraft] = useState(emptyDraft())

  // 품목 모달
  const [showAddItem, setShowAddItem] = useState(false)
  const [addItemDraft, setAddItemDraft] = useState(emptyItemDraft())
  const [editingItem, setEditingItem] = useState<Item|null>(null)
  const [editItemDraft, setEditItemDraft] = useState({name:'',category:'Coffee',unit:'bag',supplier:'',ea_per_unit:''})

  useEffect(()=>{loadData()},[])

  async function loadData() {
    const [c,i,o] = await Promise.all([
      supabase.from('companies').select('*').order('code'),
      supabase.from('supply_items').select('*').order('name'),
      supabase.from('supply_orders').select('*').order('order_date',{ascending:false})
    ])
    if(c.data){
      setCompanies(c.data)
      const d:Record<string,any>={}
      c.data.forEach((co:Company)=>{d[co.id]={next_reorder_date:co.next_reorder_date??'',alert_days_before:co.alert_days_before??14}})
      setSettingsDraft(d)
    }
    if(i.data) setItems(i.data)
    if(o.data) setOrders(o.data)
  }

  const getCode=(cid:string)=>companies.find(c=>c.id===cid)?.code??''
  const getId=(code:string)=>companies.find(c=>c.code===code)?.id

  const dashOrders = useMemo(()=>{
    return orders.filter(o=>{
      if(o.status!=='received') return false
      if(dashYear!=='ALL'&&!o.order_date.startsWith(dashYear)) return false
      if(dashCo!=='ALL'){
        const item=items.find(i=>i.id===o.item_id)
        if(!item||getCode(item.company_id)!==dashCo) return false
      }
      return true
    })
  },[orders,dashYear,dashCo,items,companies])

  const stats = useMemo(()=>{
    const totalSpend=dashOrders.reduce((s,o)=>s+(o.total_cost??0),0)
    const invoiceMap:Record<string,number>={}
    dashOrders.forEach(o=>{
      const k=`${o.order_date}__${o.invoice_ref??'x'}`
      invoiceMap[k]=(invoiceMap[k]??0)+o.quantity
    })
    const vals=Object.values(invoiceMap)
    return {totalSpend,avgUnits:vals.length>0?Math.round(vals.reduce((s,v)=>s+v,0)/vals.length):0,totalOrders:vals.length}
  },[dashOrders])

  const productRanking = useMemo(()=>{
    const map:Record<string,{name:string;company:string;orders:number;units:number;spend:number}>={}
    dashOrders.forEach(o=>{
      const item=items.find(i=>i.id===o.item_id)
      if(!item) return
      if(!map[item.id]) map[item.id]={name:item.name,company:getCode(item.company_id),orders:0,units:0,spend:0}
      map[item.id].orders+=1; map[item.id].units+=o.quantity; map[item.id].spend+=(o.total_cost??0)
    })
    return Object.values(map).sort((a,b)=>b.spend-a.spend)
  },[dashOrders,items,companies])

  const monthlySpend = useMemo(()=>{
    const map:Record<string,number>={}
    dashOrders.forEach(o=>{const m=o.order_date.substring(0,7);map[m]=(map[m]??0)+(o.total_cost??0)})
    return Object.entries(map).sort(([a],[b])=>a.localeCompare(b))
  },[dashOrders])

  const companyOrders = useMemo(()=>{
    if(!['AFS','TNT','ZFS'].includes(tab)) return []
    const cid=getId(tab); const ids=new Set(items.filter(i=>i.company_id===cid).map(i=>i.id))
    return orders.filter(o=>o.status==='received'&&ids.has(o.item_id))
  },[tab,orders,items,companies])

  const invoiceGroups = useMemo(()=>{
    const g:Record<string,{date:string;invoice:string;lines:(Order&{itemName:string;unit:string})[]}>= {}
    companyOrders.forEach(o=>{
      const item=items.find(i=>i.id===o.item_id)
      const k=`${o.order_date}__${o.invoice_ref??'no-inv'}`
      if(!g[k]) g[k]={date:o.order_date,invoice:o.invoice_ref??'—',lines:[]}
      g[k].lines.push({...o,itemName:item?.name??'?',unit:item?.unit??''})
    })
    return Object.entries(g).sort(([a],[b])=>b.localeCompare(a))
  },[companyOrders,items])

  const reorderAlerts = useMemo(()=>{
    const today=new Date().toISOString().split('T')[0]
    return companies.filter(co=>{
      if(!co.next_reorder_date) return false
      return Math.round((new Date(co.next_reorder_date).getTime()-new Date(today).getTime())/86400000)<=(co.alert_days_before??14)
    }).map(co=>({co,daysUntil:Math.round((new Date(co.next_reorder_date!).getTime()-new Date(today).getTime())/86400000)}))
  },[companies])

  const currentStock = useMemo(()=>orders.filter(o=>!o.consumed&&o.status==='received'),[orders])

  // === 주문 CRUD ===
  async function handleAddOrder(e:React.FormEvent) {
    e.preventDefault()
    const qty=Number(addDraft.quantity); const price=Number(addDraft.unit_price)||null
    await supabase.from('supply_orders').insert({item_id:addDraft.item_id,order_date:addDraft.order_date,quantity:qty,unit_price:price,total_cost:price?qty*price:null,invoice_ref:addDraft.invoice_ref||null,status:'received',consumed:false})
    setShowAdd(false); setAddDraft(emptyDraft()); await loadData()
  }

  function startEdit(order:Order) {
    setEditingOrder(order)
    setEditDraft({item_id:order.item_id,order_date:order.order_date,quantity:order.quantity,unit_price:order.unit_price?.toString()??'',invoice_ref:order.invoice_ref??''})
  }

  async function handleSaveEdit(e:React.FormEvent) {
    e.preventDefault()
    if(!editingOrder) return
    const qty=Number(editDraft.quantity); const price=Number(editDraft.unit_price)||null
    await supabase.from('supply_orders').update({item_id:editDraft.item_id,order_date:editDraft.order_date,quantity:qty,unit_price:price,total_cost:price?qty*price:null,invoice_ref:editDraft.invoice_ref||null}).eq('id',editingOrder.id)
    setEditingOrder(null); await loadData()
  }

  async function handleDelete(orderId:string) {
    if(!confirm('이 주문 기록을 삭제하시겠습니까?')) return
    await supabase.from('supply_orders').delete().eq('id',orderId)
    await loadData()
  }

  async function markConsumed(id:string) {
    await supabase.from('supply_orders').update({consumed:true,consumed_date:new Date().toISOString().split('T')[0]}).eq('id',id)
    await loadData()
  }

  async function saveSettings(cid:string) {
    const d=settingsDraft[cid]
    await supabase.from('companies').update({next_reorder_date:d.next_reorder_date||null,alert_days_before:d.alert_days_before}).eq('id',cid)
    await loadData()
  }

  // === 품목 CRUD ===
  function startEditItem(item:Item) {
    setEditingItem(item)
    setEditItemDraft({name:item.name,category:item.category,unit:item.unit,supplier:item.supplier??'',ea_per_unit:item.ea_per_unit?.toString()??''})
  }

  async function handleSaveItem(e:React.FormEvent) {
    e.preventDefault()
    if(!editingItem) return
    await supabase.from('supply_items').update({
      name:editItemDraft.name,
      category:editItemDraft.category,
      unit:editItemDraft.unit,
      supplier:editItemDraft.supplier||null,
      ea_per_unit:editItemDraft.ea_per_unit?Number(editItemDraft.ea_per_unit):null
    }).eq('id',editingItem.id)
    setEditingItem(null); await loadData()
  }

  async function handleAddItem(e:React.FormEvent) {
    e.preventDefault()
    await supabase.from('supply_items').insert({
      name:addItemDraft.name,
      category:addItemDraft.category||'Coffee',
      unit:addItemDraft.unit||'bag',
      supplier:addItemDraft.supplier||null,
      ea_per_unit:addItemDraft.ea_per_unit?Number(addItemDraft.ea_per_unit):null,
      company_id:addItemDraft.company_id
    })
    setShowAddItem(false); setAddItemDraft(emptyItemDraft()); await loadData()
  }

  const maxSpend=productRanking[0]?.spend||1
  const maxMonthly=monthlySpend.length>0?Math.max(...monthlySpend.map(([,v])=>v)):1
  const years=['ALL',...Array.from(new Set(orders.map(o=>o.order_date.substring(0,4)))).sort().reverse()]
  const totalPieSpend=productRanking.reduce((s,p)=>s+p.spend,0)

  const ActionBtns = ({order}:{order:Order}) => (
    <div className="flex gap-1 shrink-0 ml-2">
      <button type="button" onClick={()=>startEdit(order)} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-300 transition-colors">✏️</button>
      <button type="button" onClick={()=>handleDelete(order.id)} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 transition-colors">🗑️</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto p-6">

        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">소모품 관리</h1>
            <p className="text-sm text-gray-400 mt-0.5">{new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</p>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={()=>{setAddDraft(emptyDraft());setShowAdd(true)}} className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-blue-700">+ 새 주문</button>
            <a href="/" className="text-sm text-gray-400 hover:text-gray-600">← 대시보드</a>
          </div>
        </div>

        <div className="flex gap-0 mb-6 border-b border-gray-200">
          {(['DASHBOARD','AFS','TNT','ZFS','SETTINGS'] as TabType[]).map(t=>(
            <button key={t} onClick={()=>{setTab(t);setExpandedInvoice(null)}}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab===t?'border-blue-600 text-blue-600':'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t==='DASHBOARD'?'대시보드':t==='SETTINGS'?'⚙️ 설정':t}
            </button>
          ))}
        </div>

        {tab!=='SETTINGS'&&reorderAlerts.length>0&&(
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 flex flex-wrap gap-2 items-center">
            <span className="text-amber-800 font-semibold text-sm">⏰ 재주문 시기:</span>
            {reorderAlerts.map(({co,daysUntil})=>(
              <span key={co.id} className={`text-xs font-medium px-2.5 py-1 rounded-full ${daysUntil<0?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}>
                {co.code} {daysUntil<0?`D+${Math.abs(daysUntil)} 지남`:`D-${daysUntil}`}
              </span>
            ))}
          </div>
        )}

        {/* ===== DASHBOARD ===== */}
        {tab==='DASHBOARD'&&(
          <div className="space-y-4">
            <div className="flex gap-4 items-center flex-wrap">
              <div className="flex gap-1">
                {years.map(y=>(
                  <button key={y} onClick={()=>setDashYear(y)} className={`px-3 py-1 text-sm rounded-lg border transition-colors ${dashYear===y?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                    {y==='ALL'?'전체':y}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {['ALL','AFS','TNT'].map(c=>(
                  <button key={c} onClick={()=>setDashCo(c)} className={`px-3 py-1 text-sm rounded-lg border transition-colors ${dashCo===c?'bg-gray-700 text-white border-gray-700':'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                    {c==='ALL'?'합산':c}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[{label:'총 지출',value:fmt(stats.totalSpend)},{label:'평균 주문 수량',value:`${stats.avgUnits} units/회`},{label:'총 주문 횟수',value:`${stats.totalOrders} 건`}].map(s=>(
                <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-800">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <h2 className="font-semibold text-gray-700 mb-4">품목별 지출 TOP 10</h2>
                <div className="space-y-2.5">
                  {productRanking.slice(0,10).map((p,idx)=>(
                    <div key={p.name} className="flex items-center gap-2">
                      <span className="text-xs text-gray-300 w-4 text-right shrink-0">{idx+1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-700 font-medium truncate">{p.name}</span>
                          <span className="text-gray-400 ml-2 shrink-0">[{p.company}] {fmt(p.spend)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{width:`${(p.spend/maxSpend)*100}%`,backgroundColor:COLORS[idx%COLORS.length]}}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <h2 className="font-semibold text-gray-700 mb-4">월별 지출</h2>
                <div className="space-y-2">
                  {monthlySpend.map(([month,spend])=>(
                    <div key={month} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-14 shrink-0">{month}</span>
                      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{width:`${(spend/maxMonthly)*100}%`}}/>
                      </div>
                      <span className="text-xs text-gray-500 w-16 text-right shrink-0">{fmt(spend)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold text-gray-700 mb-4">품목 주문 비율</h2>
              <div className="flex gap-8 items-center">
                <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
                  {(()=>{
                    let startAngle=-Math.PI/2
                    return productRanking.slice(0,8).map((p,idx)=>{
                      const ratio=totalPieSpend>0?p.spend/totalPieSpend:0
                      const endAngle=startAngle+ratio*2*Math.PI
                      const x1=80+70*Math.cos(startAngle),y1=80+70*Math.sin(startAngle)
                      const x2=80+70*Math.cos(endAngle),y2=80+70*Math.sin(endAngle)
                      const el=<path key={idx} d={`M80 80L${x1} ${y1}A70 70 0 ${ratio>0.5?1:0} 1 ${x2} ${y2}Z`} fill={COLORS[idx%COLORS.length]} stroke="white" strokeWidth="2"/>
                      startAngle=endAngle; return el
                    })
                  })()}
                  <circle cx="80" cy="80" r="38" fill="white"/>
                  <text x="80" y="76" textAnchor="middle" fontSize="10" fill="#6b7280">총 지출</text>
                  <text x="80" y="90" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#1f2937">{fmt(totalPieSpend)}</text>
                </svg>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 flex-1">
                  {productRanking.slice(0,8).map((p,idx)=>(
                    <div key={p.name} className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{backgroundColor:COLORS[idx%COLORS.length]}}/>
                      <span className="text-gray-600 truncate">{p.name}</span>
                      <span className="text-gray-400 shrink-0 ml-auto">{totalPieSpend>0?((p.spend/totalPieSpend)*100).toFixed(1):0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {currentStock.length>0&&(
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <h2 className="font-semibold text-gray-700 mb-3">📦 현재 보유 중</h2>
                <div className="divide-y divide-gray-50">
                  {currentStock.map(order=>{
                    const item=items.find(i=>i.id===order.item_id)
                    if(!item) return null
                    return(
                      <div key={order.id} className="flex justify-between items-center py-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded shrink-0">{getCode(item.company_id)}</span>
                            <span className="text-sm font-medium text-gray-800 truncate">{item.name}</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{order.order_date} · {order.quantity}{item.unit}{order.invoice_ref?` · ${order.invoice_ref}`:''}</p>
                        </div>
                        <div className="flex gap-1 shrink-0 ml-3">
                          <button type="button" onClick={()=>markConsumed(order.id)} className="text-xs border border-gray-200 text-gray-500 hover:bg-green-50 hover:border-green-300 hover:text-green-700 px-2.5 py-1.5 rounded-lg transition-colors">소비 완료 ✓</button>
                          <button type="button" onClick={()=>startEdit(order)} className="text-xs px-2 py-1.5 rounded border border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-300 transition-colors">✏️</button>
                          <button type="button" onClick={()=>handleDelete(order.id)} className="text-xs px-2 py-1.5 rounded border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 transition-colors">🗑️</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== COMPANY TABS ===== */}
        {['AFS','TNT','ZFS'].includes(tab)&&(
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{tab} 전체 주문 이력 — {invoiceGroups.length}건</p>
            {invoiceGroups.length===0?(
              <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-400 text-sm">주문 이력이 없습니다.</div>
            ):invoiceGroups.map(([key,group])=>{
              const total=group.lines.reduce((s,l)=>s+(l.total_cost??0),0)
              const totalQty=group.lines.reduce((s,l)=>s+l.quantity,0)
              const isExp=expandedInvoice===key
              return(
                <div key={key} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <button className="w-full flex justify-between items-center p-4 hover:bg-gray-50 transition-colors text-left" onClick={()=>setExpandedInvoice(isExp?null:key)}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">{group.date}</span>
                      <span className="text-xs text-gray-400">{group.invoice}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{group.lines.length}개 품목 · {totalQty} units</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-bold text-gray-800">{fmt(total)}</span>
                      <span className="text-gray-400 text-xs">{isExp?'▲':'▼'}</span>
                    </div>
                  </button>
                  {isExp&&(
                    <div className="border-t border-gray-100">
                      <div className="grid grid-cols-5 text-xs text-gray-400 px-4 py-2 bg-gray-50 font-medium">
                        <span className="col-span-2">품목</span><span>수량</span><span>단가</span><span>소계</span>
                      </div>
                      {group.lines.map(line=>(
                        <div key={line.id} className="grid grid-cols-5 text-sm px-4 py-2.5 border-t border-gray-50 items-center hover:bg-gray-50 group">
                          <span className="text-gray-700 col-span-2 flex items-center gap-2">
                            {line.itemName}
                            <span className="hidden group-hover:flex gap-1">
                              <button type="button" onClick={()=>startEdit(line)} className="text-xs px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-300">✏️</button>
                              <button type="button" onClick={()=>handleDelete(line.id)} className="text-xs px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300">🗑️</button>
                            </span>
                          </span>
                          <span className="text-gray-600">{line.quantity}{line.unit}</span>
                          <span className="text-gray-600">{line.unit_price?fmt(line.unit_price):'—'}</span>
                          <span className="text-gray-700 font-medium">{line.total_cost?fmt(line.total_cost):'—'}</span>
                        </div>
                      ))}
                      <div className="flex justify-end px-4 py-2.5 border-t border-gray-100 bg-gray-50">
                        <span className="text-sm font-bold text-gray-800">합계 {fmt(total)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ===== SETTINGS ===== */}
        {tab==='SETTINGS'&&(
          <div className="space-y-6">
            {/* 재주문 알림 설정 */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h2 className="font-semibold text-gray-700 mb-1">재주문 알림 설정</h2>
              <p className="text-xs text-gray-400 mb-5">회사별 다음 재주문 날짜와 알림 기준일을 설정하세요.</p>
              <div className="space-y-4">
                {companies.map(co=>(
                  <div key={co.id} className="flex items-end gap-3 pb-4 border-b border-gray-50 last:border-0">
                    <div className="w-16 shrink-0">
                      <p className="text-xs text-gray-500 mb-1">회사</p>
                      <span className="inline-block bg-blue-100 text-blue-700 text-sm font-bold px-2 py-1 rounded">{co.code}</span>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1 block">다음 재주문 날짜</label>
                      <input type="date" value={settingsDraft[co.id]?.next_reorder_date??''} onChange={e=>setSettingsDraft(d=>({...d,[co.id]:{...d[co.id],next_reorder_date:e.target.value}}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
                    </div>
                    <div className="w-32 shrink-0">
                      <label className="text-xs text-gray-500 mb-1 block">며칠 전부터 알림</label>
                      <input type="number" value={settingsDraft[co.id]?.alert_days_before??14} min={1} onChange={e=>setSettingsDraft(d=>({...d,[co.id]:{...d[co.id],alert_days_before:Number(e.target.value)}}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
                    </div>
                    <button onClick={()=>saveSettings(co.id)} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 shrink-0">저장</button>
                  </div>
                ))}
              </div>
            </div>

            {/* 품목 관리 */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <div className="flex justify-between items-start mb-5">
                <div>
                  <h2 className="font-semibold text-gray-700">품목 관리</h2>
                  <p className="text-xs text-gray-400 mt-0.5">소모품 품목 목록 — 구매처·EA 수량 편집 가능</p>
                </div>
                <button type="button" onClick={()=>{setAddItemDraft({...emptyItemDraft(),company_id:companies[0]?.id??''});setShowAddItem(true)}} className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-blue-700">+ 새 품목</button>
              </div>
              <div className="divide-y divide-gray-50">
                {items.map(item=>(
                  <div key={item.id} className="flex items-center gap-3 py-3">
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium shrink-0 w-10 text-center">{getCode(item.company_id)}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-800">{item.name}</span>
                      <div className="flex gap-3 mt-0.5 flex-wrap">
                        <span className="text-xs text-gray-400">단위: {item.unit}</span>
                        {item.ea_per_unit&&<span className="text-xs text-gray-400">EA: {item.ea_per_unit}/unit</span>}
                        {item.supplier&&<span className="text-xs text-gray-400">구매처: {item.supplier}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={()=>startEditItem(item)} className="text-xs px-2.5 py-1.5 rounded border border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-300 transition-colors shrink-0">✏️ 편집</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===== 주문 추가 모달 ===== */}
        {showAdd&&(
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
              <h3 className="font-bold text-gray-800 mb-4">새 주문 기록</h3>
              <form onSubmit={handleAddOrder} className="space-y-3">
                <OrderFormFields draft={addDraft} setDraft={setAddDraft} items={items} getCode={getCode}/>
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={()=>setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
                  <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">저장</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ===== 주문 수정 모달 ===== */}
        {editingOrder&&(
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
              <h3 className="font-bold text-gray-800 mb-4">주문 수정</h3>
              <form onSubmit={handleSaveEdit} className="space-y-3">
                <OrderFormFields draft={editDraft} setDraft={setEditDraft} items={items} getCode={getCode}/>
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={()=>setEditingOrder(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
                  <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">저장</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ===== 품목 수정 모달 ===== */}
        {editingItem&&(
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
              <h3 className="font-bold text-gray-800 mb-1">품목 수정</h3>
              <p className="text-xs text-gray-400 mb-4">{getCode(editingItem.company_id)} — {editingItem.name}</p>
              <form onSubmit={handleSaveItem} className="space-y-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">품목명</label>
                  <input type="text" value={editItemDraft.name} onChange={e=>setEditItemDraft(d=>({...d,name:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" required/>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">카테고리</label>
                    <input type="text" value={editItemDraft.category} onChange={e=>setEditItemDraft(d=>({...d,category:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">단위</label>
                    <input type="text" value={editItemDraft.unit} onChange={e=>setEditItemDraft(d=>({...d,unit:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="bag, box, case..."/>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">구매처</label>
                    <input type="text" value={editItemDraft.supplier} onChange={e=>setEditItemDraft(d=>({...d,supplier:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="구매처명"/>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">EA / unit</label>
                    <input type="number" value={editItemDraft.ea_per_unit} onChange={e=>setEditItemDraft(d=>({...d,ea_per_unit:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="예: 100" min="1"/>
                  </div>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={()=>setEditingItem(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
                  <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">저장</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ===== 새 품목 추가 모달 ===== */}
        {showAddItem&&(
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
              <h3 className="font-bold text-gray-800 mb-4">새 품목 추가</h3>
              <form onSubmit={handleAddItem} className="space-y-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">회사</label>
                  <select value={addItemDraft.company_id} onChange={e=>setAddItemDraft(d=>({...d,company_id:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" required>
                    <option value="">— 선택 —</option>
                    {companies.map(co=><option key={co.id} value={co.id}>{co.code} — {co.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">품목명</label>
                  <input type="text" value={addItemDraft.name} onChange={e=>setAddItemDraft(d=>({...d,name:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" required/>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">카테고리</label>
                    <input type="text" value={addItemDraft.category} onChange={e=>setAddItemDraft(d=>({...d,category:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Coffee"/>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">단위</label>
                    <input type="text" value={addItemDraft.unit} onChange={e=>setAddItemDraft(d=>({...d,unit:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="bag, box..."/>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">구매처</label>
                    <input type="text" value={addItemDraft.supplier} onChange={e=>setAddItemDraft(d=>({...d,supplier:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="구매처명"/>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">EA / unit</label>
                    <input type="number" value={addItemDraft.ea_per_unit} onChange={e=>setAddItemDraft(d=>({...d,ea_per_unit:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="예: 100" min="1"/>
                  </div>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={()=>setShowAddItem(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
                  <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">추가</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}