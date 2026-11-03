import { canTransitionCatering } from "../../server/catering.js";
import { randomBytes, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import * as v from "../../server/validation.js";
import { canTransition } from "../../server/orders.js";

// Browser-only API fixture: actual Zod input and status rules; no persistence/auth claims.
export async function managementApi(page: Page) {
  const category={id:randomUUID(),name:"Snacks",slug:"snacks",sortOrder:0};
  const item={id:randomUUID(),slug:"beef-samosa",name:"Beef Samosa",description:"Crisp pastry with spiced beef.",categoryId:category.id,category,priceMinor:5000,available:true,imageUrl:null as string|null,sortOrder:0};
  const order={id:randomUUID(),status:"ACCEPTED",fulfilment:"PICKUP",customerName:"Review Guest",phone:"0712345678",notes:"Test fixture only",currency:"KES",
    subtotalMinor:10000,deliveryFeeMinor:0,totalMinor:10000,createdAt:new Date().toISOString(),items:[{name:item.name,quantity:2,lineTotalMinor:10000,unitPriceMinor:5000}],history:[{toStatus:"ACCEPTED",createdAt:new Date().toISOString()}]};
  const state={
    csrf:randomBytes(32).toString("hex"),authenticated:false, failLogin:false, failLoad:false, failCatering:false, loseCatering:false,
    categories:[category], items:[item], orders:[order],
    settings:{name:"Fast Food Restaurant",address:"China Square, Nairobi",openingHours:"9am–8pm",phone:null as string|null,email:null as string|null,currency:"KES",deliveryFeeMinor:15000,acceptingOrders:true,pickupEnabled:true,deliveryEnabled:true},
    catering:[] as any[], attempts:[] as any[], saved:new Map<string,{payload:any,request:any}>(),
  };
  await page.route("**/api/**",async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const send=(status:number,data:object)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
    const fail=(status:number,code:string,message:string)=>send(status,{error:{code,message}});
    if(path==="/api/csrf") return send(200,{csrfToken:state.csrf});
    if(path==="/api/menu") return send(200,{items:state.items,currency:"KES"});
    if(path==="/api/settings" && method==="GET") return send(200,{settings:state.settings});
    if(method!=="GET" && req.headers()["x-csrf-token"]!==state.csrf) return fail(403,"CSRF_REJECTED","Refresh session");
    const body=method==="GET" ? {} : req.postDataJSON();
    if(path==="/api/admin/login") {
      if(state.failLogin) return fail(401,"INVALID_LOGIN","Email or password is incorrect");
      state.authenticated=true; state.csrf=randomBytes(32).toString("hex");
      return send(200,{admin:{id:randomUUID(),email:"owner@example.invalid"},csrfToken:state.csrf});
    }
    if(path==="/api/admin/logout") { state.authenticated=false; return route.fulfill({status:204}); }
    if(path.startsWith("/api/admin") && !state.authenticated) return fail(401,"UNAUTHENTICATED","Sign in as an administrator");
    if(path==="/api/admin/session") return send(200,{admin:{email:"owner@example.invalid"}});
    if(path.startsWith("/api/admin") && state.failLoad) return fail(503,"UNAVAILABLE","Dashboard temporarily unavailable");
    try {
      if(path==="/api/catering") {
        const payload=v.cateringSchema.parse(body),key=req.headers()["idempotency-key"]!;
        state.attempts.push({key,payload});
        if(state.failCatering) { state.failCatering=false; return fail(500,"INTERNAL_ERROR","Saving failed"); }
        const previous=state.saved.get(key);
        if(previous) return send(200,{request:previous.request,replayed:true});
        const request={id:randomUUID(),...payload,status:"PENDING",createdAt:new Date().toISOString(),adminNotes:null,quoteMinor:null};
        state.catering.push(request); state.saved.set(key,{payload,request:{id:request.id,status:request.status}});
        if(state.loseCatering) { state.loseCatering=false; return route.abort("failed"); }
        return send(201,{request:{id:request.id,status:request.status}});
      }
      if(path==="/api/admin/orders/summary") return send(200,{groups:state.orders.map(o=>({status:o.status,count:1,totalMinor:o.totalMinor}))});
      if(path==="/api/admin/orders") {
        const orders=state.orders.filter(o=>!url.searchParams.get("status") || o.status===url.searchParams.get("status")); return send(200,{orders,total:orders.length});
      }
      if(path.startsWith("/api/admin/orders/")) {
        const current=state.orders.find(o=>path.includes(o.id)); if(!current) return fail(404,"NOT_FOUND","Order not found");
        if(method==="PATCH") {
          const input=v.statusSchema.parse(body);
          if(input.expectedStatus!==current.status || !canTransition(current.status as any,input.status,current.fulfilment as any)) return fail(409,"INVALID_TRANSITION","Refresh the order");
          current.status=input.status; current.history.push({toStatus:input.status,createdAt:new Date().toISOString()});
        }
        return send(200,{order:current});
      }
      if(path.startsWith("/api/admin/menu")) {
        if(method==="GET") return send(200,{items:state.items});
        const input=method==="POST" ? v.menuCreateSchema.parse(body) : v.menuUpdateSchema.parse(body);
        if(method==="POST") state.items.push({...input,id:randomUUID(),category:state.categories.find(c=>c.id===input.categoryId)} as any);
        else Object.assign(state.items.find(i=>path.endsWith(i.id))!,input);
        return send(200,{});
      }
      if(path.startsWith("/api/admin/categories")) {
        if(method==="GET") return send(200,{categories:state.categories});
        if(method==="POST") state.categories.push({...v.categorySchema.parse(body),id:randomUUID()});
        else Object.assign(state.categories.find(c=>path.endsWith(c.id))!,v.categoryUpdateSchema.parse(body));
        return send(200,{});
      }
      if(path==="/api/admin/settings") { Object.assign(state.settings,v.settingsSchema.parse(body)); return send(200,{settings:state.settings}); }
      if(path.startsWith("/api/admin/catering")) {
        if(method==="GET") {
          const requests=state.catering.filter(r=>!url.searchParams.get("status") || r.status===url.searchParams.get("status")); return send(200,{requests,total:requests.length});
        }
        const input=v.cateringUpdateSchema.parse(body),request=state.catering.find(r=>path.endsWith(r.id));
        if(!canTransitionCatering(request.status,input.status)) return fail(409,"INVALID_TRANSITION","Invalid request transition");
        if(request.status!==input.expectedStatus) return fail(409,"STALE_REQUEST","Refresh the request");
        Object.assign(request,input); return send(200,{request});
      }
    } catch { return fail(400,"VALIDATION_ERROR","Check submitted fields"); }
    return fail(404,"NOT_FOUND","Unknown fixture endpoint");
  });
  return state;
}
