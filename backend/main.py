from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import requests  # 新增:用来访问新浪的网址

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

import os
DB_DIR = os.environ.get("DB_DIR", ".")   # 默认存当前文件夹;线上会改成硬盘目录
DB = os.path.join(DB_DIR, "invest.db")

def init_db():
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT, code TEXT, buy_price REAL,
            quantity REAL, current_price REAL
        )
    """)
    c.execute("SELECT COUNT(*) FROM holdings")
    if c.fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO holdings (name, code, buy_price, quantity, current_price) VALUES (?, ?, ?, ?, ?)",
            [("贵州茅台","600519",1800,10,1900), ("平安银行","000001",12,100,13)],
        )
    conn.commit(); conn.close()

init_db()

class Holding(BaseModel):
    name: str
    code: str
    buy_price: float
    quantity: float
    current_price: float

def calc(row):
    item = {"id":row[0],"name":row[1],"code":row[2],
            "buy_price":row[3],"quantity":row[4],"current_price":row[5]}
    cost = item["buy_price"]*item["quantity"]
    market_value = item["current_price"]*item["quantity"]
    profit = market_value - cost
    profit_rate = (profit/cost)*100 if cost else 0
    item["market_value"]=round(market_value,2)
    item["profit"]=round(profit,2)
    item["profit_rate"]=round(profit_rate,2)
    return item

# ===== 新增:把纯数字代码转成新浪要的格式 =====
def to_sina_code(code):
    code = code.strip()
    code = code.zfill(6)   # 新增:不足6位就在前面补0(A股代码都是6位)
    if code.startswith("6"):        # 6开头是上海
        return "sh" + code
    else:                            # 0、3开头是深圳
        return "sz" + code

# ===== 新增:去新浪查一只股票的实时价 =====
def fetch_price(code):
    sina_code = to_sina_code(code)
    url = f"https://hq.sinajs.cn/list={sina_code}"
    # 新浪要求带上 Referer,否则会拒绝
    headers = {"Referer": "https://finance.sina.com.cn"}
    resp = requests.get(url, headers=headers, timeout=5)
    resp.encoding = "gbk"  # 新浪返回的是 gbk 编码
    text = resp.text
    # 返回格式类似:var hq_str_sh600519="贵州茅台,1800.0,1810.0,1905.0,...";
    parts = text.split('"')[1].split(",")
    if len(parts) < 4:
        return None
    current = float(parts[3])  # 第4个字段(下标3)是当前价
    return current if current > 0 else None

@app.get("/")
def read_root():
    return {"message": "我的投资系统后端已启动!"}

@app.get("/holdings")
def get_holdings():
    conn = sqlite3.connect(DB)
    rows = conn.execute("SELECT * FROM holdings").fetchall()
    conn.close()
    return [calc(r) for r in rows]

@app.post("/holdings")
def add_holding(h: Holding):
    conn = sqlite3.connect(DB)
    conn.execute("INSERT INTO holdings (name, code, buy_price, quantity, current_price) VALUES (?, ?, ?, ?, ?)",
        (h.name,h.code,h.buy_price,h.quantity,h.current_price))
    conn.commit(); conn.close()
    return {"message": "添加成功"}

@app.delete("/holdings/{holding_id}")
def delete_holding(holding_id: int):
    conn = sqlite3.connect(DB)
    conn.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
    conn.commit(); conn.close()
    return {"message": "删除成功"}

# ===== 新增:刷新所有持仓的实时价 =====
@app.post("/refresh")
def refresh_prices():
    conn = sqlite3.connect(DB)
    rows = conn.execute("SELECT id, code FROM holdings").fetchall()
    updated = 0
    for row in rows:
        holding_id, code = row[0], row[1]
        try:
            price = fetch_price(code)
            if price:
                conn.execute("UPDATE holdings SET current_price = ? WHERE id = ?", (price, holding_id))
                updated += 1
        except Exception as e:
            print(f"获取 {code} 失败: {e}")
    conn.commit(); conn.close()
    return {"message": f"已更新 {updated} 只股票的价格"}