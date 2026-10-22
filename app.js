 const cart = new Map();
        const addItemForm = document.getElementById("add-item-form");
        const orderForm = document.getElementById("order-form");
        const menuItem = document.getElementById("menu-item");
        const itemQuantity = document.getElementById("item-quantity");
        const cartItems = document.getElementById("cart-items");
        const emptyCart = document.getElementById("empty-cart");
        const itemCount = document.getElementById("item-count");
        const fulfilment = document.getElementById("fulfilment");
        const addressField = document.getElementById("address-field");
        const deliveryAddress = document.getElementById("delivery-address");
        const orderMessage = document.getElementById("order-message");
        const deliveryPrice = 150;

        function formatPrice(amount) {
            return `KSh ${amount.toLocaleString("en-KE")}`;
        }

        function renderCart() {
            cartItems.querySelectorAll(".cart-item").forEach((item) => item.remove());
            emptyCart.hidden = cart.size > 0;

            let subtotal = 0;
            let count = 0;

            cart.forEach((item, id) => {
                subtotal += item.price * item.quantity;
                count += item.quantity;

                const row = document.createElement("li");
                row.className = "cart-item";

                const description = document.createElement("span");
                const name = document.createElement("span");
                name.className = "cart-item-name";
                name.textContent = item.name;
                const detail = document.createElement("span");
                detail.className = "cart-item-detail";
                detail.textContent = `${item.quantity} × ${formatPrice(item.price)}`;
                description.append(name, detail);

                const actions = document.createElement("span");
                actions.className = "total-row";
                actions.style.alignItems = "center";
                const lineTotal = document.createElement("strong");
                lineTotal.textContent = formatPrice(item.price * item.quantity);
                const removeButton = document.createElement("button");
                removeButton.className = "remove-item-btn";
                removeButton.type = "button";
                removeButton.textContent = "Remove";
                removeButton.setAttribute("aria-label", `Remove ${item.name} from basket`);
                removeButton.addEventListener("click", () => {
                    cart.delete(id);
                    renderCart();
                });
                actions.append(lineTotal, removeButton);
                row.append(description, actions);
                cartItems.append(row);
            });

            const delivery = fulfilment.value === "delivery" && count > 0 ? deliveryPrice : 0;
            document.getElementById("subtotal").textContent = formatPrice(subtotal);
            document.getElementById("delivery-fee").textContent = formatPrice(delivery);
            document.getElementById("grand-total").textContent = formatPrice(subtotal + delivery);
            itemCount.textContent = `(${count} ${count === 1 ? "item" : "items"})`;
        }

        addItemForm.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!itemQuantity.reportValidity()) return;

            const option = menuItem.selectedOptions[0];
            const id = option.value;
            const quantity = Number(itemQuantity.value);
            const existing = cart.get(id);
            if (existing && existing.quantity + quantity > 20) {
                itemQuantity.setCustomValidity("You can add up to 20 of each item.");
                itemQuantity.reportValidity();
                itemQuantity.setCustomValidity("");
                return;
            }

            cart.set(id, {
                name: option.dataset.name,
                price: Number(option.dataset.price),
                quantity: (existing?.quantity ?? 0) + quantity
            });
            itemQuantity.value = "1";
            orderMessage.hidden = true;
            renderCart();
        });

        fulfilment.addEventListener("change", () => {
            const isDelivery = fulfilment.value === "delivery";
            addressField.hidden = !isDelivery;
            deliveryAddress.required = isDelivery;
            renderCart();
        });

        orderForm.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!orderForm.reportValidity()) return;
            if (cart.size === 0) {
                orderMessage.textContent = "Please add at least one item to your basket before reviewing your order.";
                orderMessage.hidden = false;
                return;
            }

            const name = document.getElementById("customer-name").value.trim();
            const total = document.getElementById("grand-total").textContent;
            orderMessage.textContent = `Thanks, ${name}! Your ${fulfilment.value} order is ready for review. The total is ${total}. This demo has not sent your order.`;
            orderMessage.hidden = false;
        });

        renderCart();