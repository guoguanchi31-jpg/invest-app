import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function App() {
  const [holdings, setHoldings] = useState([]);

  const [loggedIn, setLoggedIn] = useState(localStorage.getItem("loggedIn") === "true");
const [password, setPassword] = useState("");

  // 表单里输入的内容
  const [form, setForm] = useState({
    name: "", code: "", buy_price: "", quantity: "", current_price: "",
  });

  // 从后端加载数据
  const loadData = () => {
    fetch(`${API}/holdings`)
      .then((res) => res.json())
      .then((data) => setHoldings(data));
  };

  useEffect(() => { loadData(); }, []);

  const handleLogin = async () => {
  const res = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (data.ok) {
    setLoggedIn(true);
    localStorage.setItem("loggedIn", "true");
  } else {
    alert("密码错误");
  }
};

  // 输入框变化时更新 form
  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // 点击"添加"
  const handleAdd = () => {
    if (!form.name || !form.code) {
      alert("请至少填写名称和代码");
      return;
    }
    fetch(`${API}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        code: form.code,
        buy_price: Number(form.buy_price),
        quantity: Number(form.quantity),
        current_price: Number(form.current_price),
      }),
    })
      .then((res) => res.json())
      .then(() => {
        setForm({ name: "", code: "", buy_price: "", quantity: "", current_price: "" });
        loadData(); // 添加后重新加载
      });
  };

  // 点击"删除"
  const handleDelete = (index) => {
    fetch(`${API}/holdings/${index}`, { method: "DELETE" })
      .then((res) => res.json())
      .then(() => loadData());
  };

  const totalValue = holdings.reduce((sum, i) => sum + i.market_value, 0);
  const totalProfit = holdings.reduce((sum, i) => sum + i.profit, 0);

  const handleRefresh = async () => {
  await fetch(`${API}/refresh`, { method: "POST" });
  // 刷新完再重新拉一次最新数据
  const res = await fetch(`${API}/holdings`);
  const data = await res.json();
  setHoldings(data);
};

  if (!loggedIn) {
    return (
      <div style={{ maxWidth: 300, margin: "100px auto", textAlign: "center" }}>
        <h2>请输入密码</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
          style={{ padding: 8, width: "100%", marginBottom: 10 }}
        />
        <button onClick={handleLogin} style={{ padding: "8px 16px" }}>登录</button>
      </div>
    );
  }
  
  return (
    <div style={{ maxWidth: 1000, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>我的投资系统</h1>
<button onClick={handleRefresh} style={{ marginBottom: "10px", padding: "8px 16px" }}>
  🔄 刷新行情
</button>
      <div style={{ margin: "16px 0", fontSize: 18 }}>
        总市值:<b>{totalValue.toFixed(2)}</b>　
        总盈亏:
        <b style={{ color: totalProfit >= 0 ? "#e60000" : "#008000" }}>
          {totalProfit.toFixed(2)}
        </b>
      </div>

      {/* 添加持仓的表单 */}
      <div style={{ margin: "16px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input name="name" placeholder="名称" value={form.name} onChange={handleChange} />
        <input name="code" placeholder="代码" value={form.code} onChange={handleChange} />
        <input name="buy_price" placeholder="买入价" value={form.buy_price} onChange={handleChange} />
        <input name="quantity" placeholder="数量" value={form.quantity} onChange={handleChange} />
        <input name="current_price" placeholder="现价" value={form.current_price} onChange={handleChange} />
        <button onClick={handleAdd}>添加</button>
      </div>
      {/* 资产分布饼图 */}
      {holdings.length > 0 && (
        <div style={{ width: "100%", height: 300, marginBottom: 24 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={holdings}
                dataKey="market_value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={(entry) => `${entry.name} ${(entry.percent * 100).toFixed(1)}%`}
              >
                {holdings.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={["#5b8ff9", "#5ad8a6", "#f6bd16", "#e8684a", "#6dc8ec", "#9270ca"][index % 6]}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      <table border="1" cellPadding="10" style={{ borderCollapse: "collapse", width: "100%", textAlign: "center" }}>
        <thead>
          <tr>
            <th>名称</th><th>代码</th><th>买入价</th><th>现价</th>
            <th>数量</th><th>市值</th><th>盈亏</th><th>收益率</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((item, index) => {
            const color = item.profit >= 0 ? "#e60000" : "#008000";
            return (
              <tr key={index}>
                <td>{item.name}</td>
                <td>{item.code}</td>
                <td>{item.buy_price}</td>
                <td>{item.current_price}</td>
                <td>{item.quantity}</td>
                <td>{item.market_value}</td>
                <td style={{ color }}>{item.profit}</td>
                <td style={{ color }}>{item.profit_rate}%</td>
                <td>
                  <button onClick={() => handleDelete(item.id)}>删除</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;