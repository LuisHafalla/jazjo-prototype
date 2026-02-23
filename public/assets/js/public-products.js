(() => {
  const grid = document.getElementById("grid");
  if (!grid) return;

  const search = document.getElementById("search");
  const category = document.getElementById("category");
  const cartCount = document.getElementById("cartCount");
  const cartTotal = document.getElementById("cartTotal");
  const clearCartBtn = document.getElementById("clearCart");
  const checkoutBtn = document.getElementById("checkout");
  const imgUpload = document.getElementById("imgUpload");
  const selectedName = document.getElementById("selectedName");
  const clearImg = document.getElementById("clearImg");

  let products = [];
  let selectedProductId = null;
  let cart = [];

  const money = (n) => "PHP " + Number(n || 0).toFixed(2);
  const safe = (s) => String(s || "").replace(/[<&>]/g, "");
  const placeholder = (name) =>
    "data:image/svg+xml;base64," + btoa(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='340'><rect width='100%' height='100%' fill='#eaf7ee'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#0f172a' font-family='Arial' font-size='24'>${safe(name)}</text></svg>`);
  const stockLabel = (stockCases) => {
    const n = Number(stockCases || 0);
    return n <= 0 ? "Out of Stock" : n <= 10 ? "Low Stock" : "In Stock";
  };

  function updateCartBar() {
    const count = cart.reduce((s, i) => s + i.qty, 0);
    const total = cart.reduce((s, i) => s + (i.qty * i.price), 0);
    cartCount.textContent = `${count} item${count !== 1 ? "s" : ""}`;
    cartTotal.textContent = money(total);
  }

  function addToCart(product, qty) {
    const existing = cart.find(i => String(i.id) === String(product.id));
    if (existing) existing.qty += qty;
    else cart.push({ id: product.id, name: product.name, price: product.price, qty });
    updateCartBar();
  }

  function render() {
    const q = (search.value || "").toLowerCase().trim();
    const cat = category.value;
    const filtered = products.filter((p) => {
      const matchText = p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      const matchCat = cat === "all" || p.category === cat;
      return matchText && matchCat;
    });

    grid.innerHTML = filtered.map((p) => `
      <article class="card" data-id="${p.id}">
        <div class="img">
          <img src="${p.img}" alt="${p.name}">
          <div class="badge">${p.stock}</div>
        </div>
        <div class="content">
          <h3 class="title">${p.name}</h3>
          <div class="meta">
            <span>${p.category.toUpperCase()}</span>
            <span class="price">${money(p.price)}</span>
          </div>
          <div class="row">
            <input class="qty" type="number" min="1" value="1" />
            <button class="btn btn-primary add">Add to Cart</button>
            <button class="btn btn-ghost select">Select</button>
          </div>
        </div>
      </article>
    `).join("");

    grid.querySelectorAll(".card").forEach((card) => {
      const id = String(card.dataset.id);
      const product = products.find((x) => String(x.id) === id);
      const qtyInput = card.querySelector(".qty");
      const addBtn = card.querySelector(".add");
      const selBtn = card.querySelector(".select");

      addBtn.addEventListener("click", () => {
        if (product.stock === "Out of Stock") return alert("Sorry, this product is out of stock.");
        const qty = Math.max(1, Number(qtyInput.value || 1));
        addToCart(product, qty);
      });

      const selectCard = () => {
        selectedProductId = id;
        selectedName.textContent = product.name;
        grid.querySelectorAll(".card").forEach((c) => { c.style.outline = "none"; });
        card.style.outline = "3px solid rgba(22,163,74,.35)";
      };

      selBtn.addEventListener("click", selectCard);
      card.querySelector(".img").addEventListener("click", selectCard);
    });
  }

  async function loadProducts() {
    grid.innerHTML = `<div class="card" style="padding:16px;">Loading products...</div>`;
    const res = await fetch("/api/products");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load products");
    products = (data.products || []).map((p, idx) => ({
      id: p.id || p.sku || String(idx + 1),
      name: p.name,
      category: String(p.category || "").toLowerCase(),
      price: Number(p.price || 0),
      stock: stockLabel(p.stockCases ?? p.stock_cases),
      img: p.image_url || placeholder(p.name)
    }));
    render();
  }

  search.addEventListener("input", render);
  category.addEventListener("change", render);
  clearCartBtn.addEventListener("click", () => { cart = []; updateCartBar(); });
  checkoutBtn.addEventListener("click", () => {
    if (!cart.length) return alert("Your cart is empty.");
    window.location.href = "customer/customer-cart.html";
  });
  imgUpload.addEventListener("change", () => {
    imgUpload.value = "";
    alert("Product image editing here is disabled. Manage product images in the database/admin flow.");
  });
  clearImg.addEventListener("click", () => {
    alert("Image reset is disabled here. Manage product images in the database/admin flow.");
  });

  loadProducts().catch((err) => {
    grid.innerHTML = `<div class="card" style="padding:16px;">Failed to load products: ${err.message}</div>`;
  });
  updateCartBar();
})();
