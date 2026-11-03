import { get, post, patch } from "./api-client.js";
import { element as el, money, statusLabel } from "./order-core.js";
const $ = id => document.getElementById(id);
let busy = false, view = "orders", page = 1, filter = "", fieldSequence = 0;
const orderStatuses = ["PENDING","ACCEPTED","PREPARING","READY","OUT_FOR_DELIVERY","COMPLETED","CANCELLED"];
const cateringStatuses = ["PENDING","CONFIRMED","DECLINED","REQUESTED","CONTACTED","CLOSED"];
function message(text) { $("admin-message").textContent = text; }
function signedOut() {
  $("dashboard").hidden = true; $("login-panel").hidden = false;
  $("admin-content").replaceChildren(); $("admin-identity").textContent = "";
  $("login-form").reset(); view = "orders"; page = 1; filter = "";
}
function failure(error) {
  if (error.status === 401) signedOut();
  $("admin-error").textContent = error.message + (error.fields?.length ? " " + error.fields.map(f => f.path + ": " + f.message).join("; ") : "");
  $("admin-error").hidden = false; $("admin-error").focus(); message("");
}
async function run(action) {
  if (busy) return;
  busy = true; $("admin-error").hidden=true; $("main-content").setAttribute("aria-busy","true");
  for (const button of document.querySelectorAll(".admin-page button")) button.disabled = true;
  try { await action(); }
  catch (error) { failure(error); }
  finally { busy = false; $("main-content").setAttribute("aria-busy","false"); for (const button of document.querySelectorAll(".admin-page button")) button.disabled = false; }
}
function button(text, action) {
  const node = el("button", text); node.type = "button"; node.onclick = () => void run(action); return node;
}
function field(form, name, label, value = "", type = "text", options) {
  const wrap = el("label", label);
  const node = el(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
  node.name = name; node.id = "admin-field-" + (++fieldSequence);
  wrap.htmlFor = node.id;
  // Keep label text independent of option text for assistive technology and selectors.
  wrap.textContent = ""; wrap.append(el("span", label));
  const limits = {name:120,slug:80,imageUrl:1000};
  if (limits[name]) node.maxLength = limits[name];
  if (name === "slug") node.pattern = "[a-z0-9]+(-[a-z0-9]+)*";
  if (type === "select") for (const [id, text] of options) node.append(new Option(text, id));
  else if (type !== "textarea") node.type = type;
  if (type === "checkbox") node.checked = Boolean(value); else node.value = value ?? "";
  wrap.append(node); form.append(wrap); return node;
}
function submit(form, text, action) {
  const node = el("button",text); node.type = "submit"; form.append(node);
  form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) void run(() => action(new FormData(form))); };
}
const output=text=>el("p",text);
function pagination(content, total) {
  const bar = el("div", undefined,"admin-pagination"), pages = Math.max(1,Math.ceil(total/20));
  if (page > 1) bar.append(button("Previous page", async () => { page--; await load(); }));
  bar.append(output("Page " + page + " of " + pages + " · " + total + " records"));
  if (page < pages) bar.append(button("Next page", async () => { page++; await load(); }));
  content.append(bar);
}
function statusFilter(content, statuses) {
  const form = el("form",undefined,"admin-filter");
  form.setAttribute("aria-label","Status filter");
  field(form,"status","Filter by status",filter,"select",[["","All statuses"],...statuses.map(s => [s,s === "PENDING" && statuses === cateringStatuses ? "Pending admin decision" : statusLabel(s)])]);
  submit(form,"Apply filter", async data => { filter = data.get("status"); page=1; await load(); });
  content.append(form, button("Refresh",load));
}
function transitions(order) {
  return ({ PENDING:["CANCELLED"], ACCEPTED:["PREPARING","CANCELLED"], PREPARING:["READY","CANCELLED"],
    READY: order.fulfilment === "PICKUP" ? ["COMPLETED","CANCELLED"] : ["OUT_FOR_DELIVERY","CANCELLED"],
    OUT_FOR_DELIVERY:order.fulfilment === "DELIVERY" ? ["COMPLETED","CANCELLED"] : ["CANCELLED"], COMPLETED:[], CANCELLED:[] })[order.status];
}
async function orders(content) {
  statusFilter(content,orderStatuses);
  const [data, summary] = await Promise.all([get("api/admin/orders?page=" + page + "&pageSize=20" + (filter ? "&status=" + filter : "")),get("api/admin/orders/summary")]);
  const cards = el("div",undefined,"admin-summary");
  for (const status of orderStatuses) {
    const group = summary.groups.find(g => g.status === status);
    const card = el("div",undefined,"summary-card"); card.append(output(statusLabel(status)),el("strong",String(group?.count || 0)),output(money(group?.totalMinor || 0))); cards.append(card);
  }
  content.append(output("All-time order counts and order value by status (not payment or revenue)."),cards);
  const list = el("ul",undefined,"admin-list"), detail = el("div",undefined,"admin-detail");
  for (const order of data.orders) {
    const row = el("li",undefined,"admin-record");
    row.append(el("h3",statusLabel(order.status) + " · " + money(order.totalMinor)),output(order.id),
      output(new Date(order.createdAt).toLocaleString("en-KE",{ timeZone:"Africa/Nairobi" }) + " · " + statusLabel(order.fulfilment)),
      button("View order " + order.id.slice(0,8), async () => {
        const { order: current } = await get("api/admin/orders/" + order.id);
        detail.replaceChildren(el("h3","Order details"),output(current.id),output(current.customerName + " · " + current.phone),
          output(current.deliveryAddress || "Pickup"),output(current.notes || "No instructions"));
        for (const item of current.items) detail.append(output(item.quantity + " × " + item.name + " · " + money(item.lineTotalMinor)));
        detail.append(output("Total: " + money(current.totalMinor)));
        const history = el("ol");
        for (const event of current.history) history.append(el("li",statusLabel(event.toStatus) + (event.reason ? " · Reason: " + event.reason : "") + " · " + new Date(event.createdAt).toLocaleString("en-KE",{timeZone:"Africa/Nairobi"})));
        detail.append(el("h3","Status history"),history);
        if (current.status === "PENDING") detail.append(output("Legacy pending order: preserved without acceptance. Contact the customer before cancelling with a reason; no approval action is available."));
        const allowed = transitions(current);
        if (allowed.length) {
          const form = el("form"); const status = field(form,"status","Next status",allowed[0],"select",allowed.map(s => [s,statusLabel(s)]));
          const reason = field(form,"reason","Cancellation reason (visible to customer)","","textarea"); reason.maxLength=1000;
          const updateReason = () => { reason.parentElement.hidden = status.value !== "CANCELLED"; reason.disabled = status.value !== "CANCELLED"; reason.required = status.value === "CANCELLED"; };
          status.addEventListener("change",updateReason); updateReason();
          submit(form,"Update order status",async values => {
            await patch("api/admin/orders/" + current.id + "/status",{expectedStatus:current.status,status:values.get("status"),...(values.get("status")==="CANCELLED" ? {reason:values.get("reason")} : {})});
            await load(); message("Order status saved.");
          }); detail.append(form);
        } else detail.append(output("This order has a final status."));
        detail.tabIndex=-1; detail.focus();
      }));
    list.append(row);
  }
  if(!data.orders.length) list.append(el("li","No orders match this filter.","admin-empty"));
  content.append(list); pagination(content,data.total); content.append(detail);
}
async function menu(content) {
  const [{items},{categories}] = await Promise.all([get("api/admin/menu"),get("api/admin/categories")]);
  content.append(el("h3","Categories"));
  function categoryForm(category) {
    const form = el("form",undefined,"admin-record");
    const name = field(form,"name","Category name",category?.name); name.required=true; name.maxLength=80;
    field(form,"slug","Category slug",category?.slug).required=true;
    const sort = field(form,"sortOrder","Display order",category?.sortOrder || 0,"number"); sort.min="0"; sort.max="10000";
    submit(form,category ? "Save category" : "Create category",async data => {
      const body={name:data.get("name"),slug:data.get("slug"),sortOrder:Number(data.get("sortOrder"))};
      if (category) await patch("api/admin/categories/" + category.id,body); else await post("api/admin/categories",body);
      await load(); message("Category saved.");
    }); return form;
  }
  const categoryNew = el("details"); categoryNew.append(el("summary","Add category"),categoryForm()); content.append(categoryNew);
  for (const category of categories) {
    const detail = el("details"); detail.append(el("summary",category.name),categoryForm(category)); content.append(detail);
  }
  content.append(el("h3","Menu items"));
  function itemForm(item) {
    const form=el("form",undefined,"admin-record admin-fields");
    field(form,"name","Item name",item?.name).required=true;
    field(form,"slug","Item slug",item?.slug).required=true;
    const description=field(form,"description","Description",item?.description,"textarea"); description.required=true; description.maxLength=600;
    field(form,"categoryId","Category",item?.categoryId || categories[0]?.id,"select",categories.map(c => [c.id,c.name])).required=true;
    const price=field(form,"priceMinor","Price (KSh)",item ? (item.priceMinor/100).toFixed(2) : "","number");
    price.required=true; price.min="0"; price.max="10000"; price.step=".01";
    const sort=field(form,"sortOrder","Display order",item?.sortOrder || 0,"number"); sort.min="0"; sort.max="10000";
    field(form,"imageUrl","Image reference (optional HTTPS URL or images/ path)",item?.imageUrl);
    field(form,"available","Available",item ? item.available : true,"checkbox");
    submit(form,item ? "Save item" : "Create item",async data => {
      const body={name:data.get("name"),slug:data.get("slug"),description:data.get("description"),categoryId:data.get("categoryId"),
        priceMinor:Math.round(Number(data.get("priceMinor"))*100),sortOrder:Number(data.get("sortOrder")),imageUrl:data.get("imageUrl").trim() || null,available:data.has("available")};
      if(item) await patch("api/admin/menu/" + item.id,body); else await post("api/admin/menu",body);
      await load(); message("Menu item saved.");
    }); return form;
  }
  if(categories.length) { const add=el("details"); add.append(el("summary","Add menu item"),itemForm()); content.append(add); }
  else content.append(output("Create a category before adding a menu item."));
  for(const item of items) {
    const detail=el("details"); detail.append(el("summary",item.name + " · " + money(item.priceMinor) + (item.available ? "" : " · Unavailable")),itemForm(item)); content.append(detail);
  }
  if(!items.length) content.append(output("No menu items yet."));
}
async function settings(content) {
  const {settings:s}=await get("api/settings"),form=el("form",undefined,"admin-fields");
  for(const [name,label] of [["name","Restaurant name"],["address","Address"],["openingHours","Opening hours"],["phone","Phone (optional)"],["email","Email (optional)"]]) {
    const node=field(form,name,label,s[name]); node.maxLength= name==="email" ? 254 : name==="address" ? 400 : name==="openingHours" ? 300 : name==="phone" ? 30 : 120;
    node.required=!["phone","email"].includes(name);
  }
  const fee=field(form,"deliveryFeeMinor","Delivery fee (KSh)",(s.deliveryFeeMinor/100).toFixed(2),"number"); fee.min="0"; fee.max="10000"; fee.step=".01"; fee.required=true;
  for(const [name,label] of [["acceptingOrders","Accept orders"],["pickupEnabled","Enable pickup"],["deliveryEnabled","Enable delivery"]]) field(form,name,label,s[name],"checkbox");
  submit(form,"Save restaurant settings",async data => {
    const body={}; for(const name of ["name","address","openingHours","phone","email"]) body[name]=data.get(name).trim() || null;
    body.deliveryFeeMinor=Math.round(Number(data.get("deliveryFeeMinor"))*100);
    for(const name of ["acceptingOrders","pickupEnabled","deliveryEnabled"]) body[name]=data.has(name);
    await patch("api/admin/settings",body); message("Restaurant settings saved.");
  }); content.append(form);
}
async function catering(content) {
  statusFilter(content,cateringStatuses);
  const data=await get("api/admin/catering?page=" + page + "&pageSize=20" + (filter ? "&status=" + filter : ""));
  content.append(output("New requests stay pending until you explicitly confirm or decline them. Saving a quote alone does not confirm a booking. Legacy statuses remain labelled; closed legacy requests retain their historical outcome. Quotes and internal notes are private; contact customers separately because this dashboard sends no messages."));
  const list=el("ul",undefined,"admin-list");
  for(const request of data.requests) {
    const row=el("li",undefined,"admin-record");
    row.append(el("h3",request.customerName + " · " + (request.status === "PENDING" ? "Pending admin decision" : statusLabel(request.status))),output(request.id),output(request.phone),
      output(request.eventDate.slice(0,10) + " · " + request.guestCount + " guests · " + request.package),
      output(request.location),output(request.eventDetails || "No event details"));
    const form=el("form");
    const allowed=["PENDING","REQUESTED","CONTACTED"].includes(request.status) ? [request.status,"CONFIRMED","DECLINED"] : [request.status];
    field(form,"status","Request status",request.status,"select",allowed.map(s => [s,s === "PENDING" ? "Pending admin decision" : statusLabel(s)]));
    field(form,"adminNotes","Internal notes",request.adminNotes,"textarea").maxLength=2000;
    const quote=field(form,"quoteMinor","Optional quote (KSh)",request.quoteMinor == null ? "" : (request.quoteMinor/100).toFixed(2),"number");
    quote.min="0"; quote.max="10000000"; quote.step=".01";
    submit(form,"Save catering request",async values => {
      await patch("api/admin/catering/" + request.id,{expectedStatus:request.status,status:values.get("status"),adminNotes:values.get("adminNotes"),
        quoteMinor:values.get("quoteMinor")==="" ? null : Math.round(Number(values.get("quoteMinor"))*100)});
      await load(); message("Catering request saved. No message was sent.");
    }); row.append(form); list.append(row);
  }
  if(!data.requests.length) list.append(el("li","No catering requests match this filter.","admin-empty"));
  content.append(list); pagination(content,data.total);
}
async function load() {
  message("Loading dashboard…");
  const content=el("div");
  await ({orders,menu,settings,catering})[view](content);
  $("view-heading").textContent={orders:"Orders",menu:"Menu & categories",settings:"Restaurant settings",catering:"Catering requests"}[view];
  $("admin-content").replaceChildren(content);
  $("view-heading").focus({preventScroll:true});
  for(const tab of document.querySelectorAll("[data-view]")) tab.setAttribute("aria-current",String(tab.dataset.view===view));
  message("Dashboard up to date.");
}
$("login-form").onsubmit=event => {
  event.preventDefault(); const form=event.currentTarget; if(!form.reportValidity()) return;
  void run(async () => {
    const data=new FormData(form);
    const result=await post("api/admin/login",{email:data.get("email"),password:data.get("password")});
    form.reset(); $("login-panel").hidden=true; $("dashboard").hidden=false; $("admin-identity").textContent=result.admin.email;
    await load();
  });
};
$("logout").onclick=() => void run(async () => { await post("api/admin/logout",{}); signedOut(); message("Signed out."); });
for(const tab of document.querySelectorAll("[data-view]")) tab.onclick=() => void run(async () => { view=tab.dataset.view; page=1; filter=""; await load(); $("view-heading").focus(); });
void run(async () => {
  try {
    const {admin}=await get("api/admin/session"); $("admin-identity").textContent=admin.email; $("login-panel").hidden=true; $("dashboard").hidden=false; await load();
  } catch(error) {
    if(error.status===401) { signedOut(); message("Sign in to manage the restaurant."); }
    else { signedOut(); throw error; }
  }
});


window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  signedOut();
  void run(async () => {
    const {admin} = await get("api/admin/session");
    $("admin-identity").textContent = admin.email; $("login-panel").hidden = true; $("dashboard").hidden = false;
    await load();
  });
});
