const bookingForm = document.getElementById("catering-booking-form");
const eventDateInput = document.getElementById("event-date");
const eventDayInput = document.getElementById("event-day");
const packageSelect = document.getElementById("catering-package");
const bookingResult = document.getElementById("booking-result");
const bookingSummary = document.getElementById("booking-summary");
const bookingEmailLink = document.getElementById("booking-email-link");

function localDateString(date) {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 10);
}

eventDateInput.min = localDateString(new Date());

eventDateInput.addEventListener("input", () => {
    if (!eventDateInput.value) {
        eventDayInput.value = "";
        return;
    }

    const selectedDate = new Date(`${eventDateInput.value}T00:00:00`);
    eventDayInput.value = new Intl.DateTimeFormat("en", { weekday: "long" }).format(selectedDate);
});

document.querySelectorAll("[data-package]").forEach((button) => {
    button.addEventListener("click", () => {
        packageSelect.value = button.dataset.package;
        document.getElementById("booking").scrollIntoView({ behavior: "smooth" });
        packageSelect.focus({ preventScroll: true });
    });
});

bookingForm.addEventListener("input", () => {
    bookingResult.hidden = true;
});

bookingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!bookingForm.reportValidity()) return;

    const formData = new FormData(bookingForm);
    const customerName = formData.get("customerName").toString().trim();
    const phone = formData.get("phone").toString().trim();
    const eventDate = eventDateInput.value;
    const eventDay = eventDayInput.value;
    const location = formData.get("location").toString().trim();
    const guestCount = formData.get("guestCount").toString();
    const packageName = formData.get("package").toString();
    const eventDetails = formData.get("eventDetails").toString().trim();
    const formattedDate = new Intl.DateTimeFormat("en", {
        dateStyle: "long"
    }).format(new Date(`${eventDate}T00:00:00`));
    const subject = `Catering booking request - ${customerName}`;
    const body = [
        "Catering booking request",
        "",
        `Name: ${customerName}`,
        `Phone: ${phone}`,
        `Event date: ${eventDay}, ${formattedDate}`,
        `Location: ${location}`,
        `Guests: ${guestCount}`,
        `Package: ${packageName}`,
        `Event details: ${eventDetails || "None provided"}`
    ].join("\n");

    bookingSummary.textContent = `${packageName} catering request for ${guestCount} guest${guestCount === "1" ? "" : "s"} on ${eventDay}, ${formattedDate} in ${location}.`;
    bookingEmailLink.href = `mailto:info@fastfoodrestaurant.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    bookingResult.hidden = false;
    bookingResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
