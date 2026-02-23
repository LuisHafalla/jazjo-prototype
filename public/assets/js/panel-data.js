(() => {
  const path = location.pathname;
  const isAdmin = path.includes("/admin/");
  const isStaff = path.includes("/staff/");
  if (!isAdmin && !isStaff) return;

  const money = (n) => `PHP ${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 0 })}`;
  const fmtDate = (v) => {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));

  async function api(pathname) {
    const token = localStorage.getItem("jazjo_access_token") || sessionStorage.getItem("jazjo_access_token") || "";
    const res = await fetch(pathname, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function apiPatch(pathname, body) {
    const token = localStorage.getItem("jazjo_access_token") || sessionStorage.getItem("jazjo_access_token") || "";
    const res = await fetch(pathname, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body || {})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function statusText(status) {
    return String(status || "Order Placed");
  }

  function statusBadge(status) {
    const s = statusText(status);
    if (s === "Delivered") return "green";
    if (s === "In Transit" || s === "Out for Delivery") return "blue";
    if (s === "Cancelled") return "red";
    return "yellow";
  }

  function paymentBadgeClass(paymentStatus) {
    const s = String(paymentStatus || "").toLowerCase();
    if (s === "paid") return "green";
    if (s === "failed" || s === "cancelled") return "red";
    return "yellow";
  }

  function paymentBadgeLabel(paymentStatus) {
    const s = String(paymentStatus || "").toLowerCase();
    if (!s) return "Unknown";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function panelTagClass(status) {
    const s = statusText(status);
    if (s === "Order Placed") return "p";
    if (s === "Preparing") return "prep";
    return "transit";
  }

  async function renderAdminDashboard() {
    const data = await api("/api/panel/admin/dashboard");
    const tbody = document.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = (data.recentOrders || []).slice(0, 8).map(o => `
      <tr>
        <td>${esc(o.id)}</td>
        <td>${esc(o.customerName)}</td>
        <td>${money(o.total)}</td>
        <td>${esc(o.status)}</td>
      </tr>
    `).join("") || `<tr><td colspan="4">No orders yet</td></tr>`;
  }

  async function renderAdminOrders() {
    const data = await api("/api/panel/admin/orders");
    const tbody = document.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = (data.orders || []).map(o => `
      <tr>
        <td>${esc(o.id)}</td>
        <td>${fmtDate(o.createdAt)}</td>
        <td>${esc(o.customerName)}</td>
        <td>${money(o.total)}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <span>${esc(o.status)}</span>
            <span class="badge ${paymentBadgeClass(o.paymentStatus)}">${paymentBadgeLabel(o.paymentStatus)}</span>
          </div>
        </td>
        <td><button class="btn2" type="button" data-order-action="${esc(o.id)}" data-next-status="${o.status === "Order Placed" ? "Preparing" : o.status === "Preparing" ? "In Transit" : o.status === "In Transit" ? "Out for Delivery" : o.status === "Out for Delivery" ? "Delivered" : ""}">${o.status === "Delivered" || o.status === "Cancelled" ? "View Details" : (o.status === "Order Placed" ? "Mark Preparing" : o.status === "Preparing" ? "Mark In Transit" : o.status === "In Transit" ? "Mark Out for Delivery" : "Mark Delivered")}</button></td>
      </tr>
    `).join("") || `<tr><td colspan="6">No orders found</td></tr>`;
    bindOrderActionButtons(renderAdminOrders);
  }

  async function renderAdminInventory() {
    const data = await api("/api/panel/admin/inventory");
    const tbodies = document.querySelectorAll("tbody");
    if (tbodies[0]) {
      tbodies[0].innerHTML = (data.inventory || []).map(p => `
        <tr>
          <td>${esc(p.name)}</td>
          <td>${Number(p.stockCases || 0)}</td>
          <td>${esc(p.status)}</td>
          <td><button class="btn2" type="button">Edit</button></td>
        </tr>
      `).join("") || `<tr><td colspan="4">No products found</td></tr>`;
    }
    if (tbodies[1]) {
      tbodies[1].innerHTML = (data.lowStock || []).slice(0, 10).map(p => `
        <tr><td>${esc(p.name)}</td><td>${Number(p.stockCases || 0)} cases</td></tr>
      `).join("") || `<tr><td colspan="2">No low stock alerts</td></tr>`;
    }
  }

  async function renderAdminCustomers() {
    const data = await api("/api/panel/admin/customers");
    const tbody = document.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = (data.customers || []).map(c => `
      <tr>
        <td>${esc(c.name)}</td>
        <td>${esc(c.email)}</td>
        <td>${Number(c.totalOrders || 0)}</td>
        <td>${esc(c.lastOrder || "-")}</td>
      </tr>
    `).join("") || `<tr><td colspan="4">No customers found</td></tr>`;
  }

  async function renderAdminReports() {
    const data = await api("/api/panel/admin/reports");
    const tbody = document.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = (data.reports || []).map(r => `
      <tr><td>${esc(r.reportType)}</td><td>${esc(r.coverage)}</td><td>${esc(r.status)}</td></tr>
    `).join("") || `<tr><td colspan="3">No reports available</td></tr>`;
  }

  async function renderAdminRewards() {
    const data = await api("/api/panel/admin/rewards");
    const top = (data.rewards || [])[0];
    const greenCard = document.querySelector(".greenCard");
    if (greenCard && top) {
      const balance = greenCard.querySelector("div[style*='font-size:54px']");
      const sub = greenCard.querySelector("div[style*='sample']");
      if (balance) balance.textContent = Number(top.points || 0).toLocaleString();
      if (sub) sub.textContent = `${top.customer || top.email} current points`;
    }
  }

  async function renderAdminSales() {
    const data = await api("/api/panel/admin/sales");
    const kpis = document.querySelectorAll(".kpi2 .value");
    if (kpis[0]) kpis[0].textContent = money(data.kpis?.todaySales || 0);
    if (kpis[1]) kpis[1].textContent = String(data.kpis?.transactions || 0);
    if (kpis[2]) kpis[2].textContent = data.kpis?.bestSeller || "-";
    if (kpis[3]) kpis[3].textContent = money(data.kpis?.refunds || 0);

    const tbody = document.querySelector("tbody");
    if (tbody) {
      tbody.innerHTML = (data.rows || []).map(r => `
        <tr>
          <td>${esc(r.period)}</td>
          <td>${money(r.sales)}</td>
          <td>${Number(r.transactions || 0)}</td>
          <td>${esc(r.bestSeller || "-")}</td>
        </tr>
      `).join("") || `<tr><td colspan="4">No sales data</td></tr>`;
    }
  }

  function renderTimeline(container, order) {
    if (!container) return;
    if (!order) {
      container.innerHTML = `<div class="small">No active delivery orders found.</div>`;
      return;
    }
    const steps = [
      "Order Placed",
      "Preparing",
      "In Transit",
      "Out for Delivery",
      "Delivered"
    ];
    const idx = Math.max(0, steps.indexOf(order.status));
    const events = new Map((order.status_events || []).map(e => [statusText(e.status), e]));
    container.innerHTML = `
      <div class="trackHead">
        <div class="iconBox">D</div>
        <div>
          <div style="font-weight:1200;font-size:18px">Active Delivery</div>
          <div class="small">Order #${esc(order.id)}</div>
        </div>
      </div>
      ${steps.map((title, i) => {
        const done = i <= idx;
        const event = events.get(title);
        const time = event?.created_at ? fmtDate(event.created_at) : (done ? fmtDate(order.createdAt) : "Pending");
        const note = event?.note || "";
        return `
          <div class="step">
            <div>
              <div class="dot ${done ? "done" : ""}">${done ? "OK" : "."}</div>
              ${i < steps.length - 1 ? `<div class="line" style="height:70px"></div>` : ""}
            </div>
            <div class="info" style="${done ? "" : "opacity:.6"}">
              <h4>${title}</h4>
              <div class="meta">${esc(time)}</div>
              <p>${esc(note || (title === "Delivered" ? "Final status once customer receives the order." : "Status update from operations."))}</p>
            </div>
          </div>
        `;
      }).join("")}
    `;
  }

  async function renderAdminDelivery() {
    const data = await api("/api/panel/admin/delivery");
    renderTimeline(document.querySelector(".timeline"), data.activeOrder);
  }

  async function renderStaffOrders() {
    const data = await api("/api/panel/staff/orders");
    const tbody = document.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = (data.orders || []).map(o => `
      <tr>
        <td>${esc(o.id)}</td><td>${esc(o.customerName)}</td><td>${money(o.total)}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <span class="tag ${panelTagClass(o.status)}">${esc(o.status)}</span>
            <span class="badge ${paymentBadgeClass(o.paymentStatus)}">${paymentBadgeLabel(o.paymentStatus)}</span>
          </div>
        </td>
        <td><button class="btn2" type="button" data-order-action="${esc(o.id)}" data-next-status="${o.status === "Order Placed" ? "Preparing" : o.status === "Preparing" ? "In Transit" : o.status === "In Transit" ? "Out for Delivery" : o.status === "Out for Delivery" ? "Delivered" : ""}">${o.status === "Delivered" || o.status === "Cancelled" ? "No Action" : (o.status === "Order Placed" ? "Mark Preparing" : o.status === "Preparing" ? "Mark In Transit" : o.status === "In Transit" ? "Mark Out for Delivery" : "Mark Delivered")}</button></td>
      </tr>
    `).join("") || `<tr><td colspan="5">No orders found</td></tr>`;
    bindOrderActionButtons(renderStaffOrders);
  }

  function bindOrderActionButtons(refreshFn) {
    document.querySelectorAll("[data-order-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const orderCode = btn.getAttribute("data-order-action");
        const nextStatus = btn.getAttribute("data-next-status");
        if (!nextStatus) return;
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Updating...";
        try {
          await apiPatch(`/api/orders/${encodeURIComponent(orderCode)}/status`, { status: nextStatus });
          await refreshFn();
        } catch (err) {
          if (String(err.message).includes("QRPH order")) {
            alert("Cannot update status yet: QRPH payment is still unpaid.");
          } else {
            alert(`Failed to update order status: ${err.message}`);
          }
          btn.disabled = false;
          btn.textContent = oldText;
        }
      });
    });
  }

  async function renderStaffInventory() {
    const data = await api("/api/panel/staff/inventory");
    const tbody = document.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = (data.inventory || []).map(p => {
      const cls = p.status === "In Stock" ? "ok" : p.status === "Low Stock" ? "low" : "out";
      return `<tr><td>${esc(p.name)}</td><td>${Number(p.stockCases || 0)}</td><td><span class="status ${cls}">${esc(p.status)}</span></td></tr>`;
    }).join("") || `<tr><td colspan="3">No products found</td></tr>`;
  }

  async function renderStaffDelivery() {
    const data = await api("/api/panel/staff/delivery");
    renderTimeline(document.querySelector(".timeline"), data.activeOrder);
  }

  async function boot() {
    try {
      if (path.endsWith("/admin-dashboard.html")) return renderAdminDashboard();
      if (path.endsWith("/admin-orders.html")) return renderAdminOrders();
      if (path.endsWith("/admin-inventory.html")) return renderAdminInventory();
      if (path.endsWith("/admin-customers.html")) return renderAdminCustomers();
      if (path.endsWith("/admin-reports.html")) return renderAdminReports();
      if (path.endsWith("/admin-rewards.html")) return renderAdminRewards();
      if (path.endsWith("/admin-sales.html")) return renderAdminSales();
      if (path.endsWith("/admin-delivery.html")) return renderAdminDelivery();
      if (path.endsWith("/staff-orders.html")) return renderStaffOrders();
      if (path.endsWith("/staff-inventory.html")) return renderStaffInventory();
      if (path.endsWith("/staff-delivery.html")) return renderStaffDelivery();
    } catch (err) {
      console.error(err);
      if (String(err.message).toLowerCase().includes("missing bearer token") || String(err.message).toLowerCase().includes("forbidden")) {
        alert("You need to log in with the correct role to access this page.");
      }
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
