import { post } from "./api-client.js";
import { isId } from "./order-core.js";
const form=document.getElementById("catering-booking-form"), date=document.getElementById("event-date"), day=document.getElementById("event-day");
const result=document.getElementById("booking-result"), error=document.getElementById("catering-error"), submit=form.querySelector("[type=submit]");
let attempt, busy=false;
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Nairobi",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
date.min=today();
date.addEventListener("input",()=> {
  day.value=date.value && Number.isFinite(Date.parse(date.value+"T12:00:00+03:00")) ? new Intl.DateTimeFormat("en",{weekday:"long",timeZone:"Africa/Nairobi"}).format(new Date(date.value+"T12:00:00+03:00")) : "";
});
for(const button of document.querySelectorAll("[data-package]")) button.onclick=()=> {
  if(attempt || busy) return;
  document.getElementById("catering-package").value=button.dataset.package;
  document.getElementById("booking").scrollIntoView(); document.getElementById("catering-package").focus({preventScroll:true});
};
function showError(text) { error.textContent=text; error.hidden=false; error.focus(); }
form.addEventListener("input",event=> { event.target.setCustomValidity?.(""); result.hidden=true; });
form.onsubmit=async event=> {
  event.preventDefault(); if(busy) return;
  date.min=today();
  if (!attempt) {
    for (const name of ["customerName", "location"]) {
      const input = form.elements.namedItem(name);
      input.setCustomValidity(input.value.trim() ? "" : "Enter " + (name === "customerName" ? "your name." : "the event location."));
    }
    const phone = form.elements.namedItem("phone");
    phone.setCustomValidity(/^\+?[0-9 ()-]{7,30}$/.test(phone.value.trim()) && phone.value.replace(/\D/g, "").length >= 7 ? "" : "Enter a valid phone number.");
    if (!form.reportValidity()) return;
  }
  if(!attempt) {
    const values=new FormData(form);
    const payload=Object.fromEntries(["customerName","phone","eventDate","location","package","eventDetails"].map(name=>[name,String(values.get(name)).trim()]));
    payload.guestCount=Number(values.get("guestCount")); if(!payload.eventDetails) delete payload.eventDetails;
    attempt={key:crypto.randomUUID(),payload};
  }
  busy=true; submit.disabled=true; submit.textContent="Saving request…"; error.hidden=true;
  form.setAttribute("aria-busy","true"); document.getElementById("catering-message").textContent = "Saving your catering request…";
  for(const control of form.querySelectorAll("input,select,textarea")) control.disabled=true;
  try {
    const saved=await post("api/catering",attempt.payload,attempt.key);
    if(!isId(saved.request?.id) || !["PENDING","CONFIRMED","DECLINED","REQUESTED","CONTACTED","CLOSED"].includes(saved.request.status)) throw new Error("The saved request response could not be verified.");
    document.getElementById("booking-summary").textContent="Request reference: "+saved.request.id + " · " + ({PENDING:"Pending admin decision",CONFIRMED:"Confirmed by admin",DECLINED:"Declined by admin",REQUESTED:"Legacy request — decision outstanding",CONTACTED:"Legacy contacted — decision outstanding",CLOSED:"Legacy closed — outcome unconfirmed"}[saved.request.status]);
    result.hidden=false; result.focus(); attempt=undefined; form.reset(); day.value=""; submit.textContent="Send another catering request";
  } catch(failure) {
    if(failure.status===400) {
      attempt=undefined; showError(failure.message + (failure.fields?.length ? " "+failure.fields.map(f=>f.path+": "+f.message).join("; ") : "") + " Your details are kept.");
      submit.textContent="Send catering request";
    } else {
      showError(failure.message+" Saving is unconfirmed. Keep this tab open and retry the same request before sending another.");
      submit.textContent="Retry same request";
    }
  } finally {
    document.getElementById("catering-message").textContent = "";
    busy=false; submit.disabled=false; form.setAttribute("aria-busy","false");
    for(const control of form.querySelectorAll("input,select,textarea")) control.disabled=Boolean(attempt);
  }
};
window.addEventListener("beforeunload",event=> { if(attempt) { event.preventDefault(); event.returnValue=""; } });
