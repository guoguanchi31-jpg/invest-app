from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB = "invest.db"

# 初始化数据库:如果表不存在就创建,并放入两条初始数据
def init_db():
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            code TEXT,
            buy_price REAL,
            quantity REAL,
            current_price REAL
        )
    """)
    # 只有表是空的时候,才插入两条示例数据
    c.execute("SELECT COUNT(*) FROM holdings")
    if c.fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO holdings (name, code, buy_price, quantity, current_price) VALUES (?, ?, ?, ?, ?)",
            [
                ("苹果", "AAPL", 150, 10, 195),
                ("腾讯", "00700", 320, 5, 380),
            ],
        )
    conn.commit()
    conn.close()

init_db()

class Holding(BaseModel):
    name: str
    code: str
    buy_price: float
    quantity: float
    current_price: float

def calc(row):
    # row 是数据库查出来的一行,顺序:id,name,code,buy_price,quantity,current_price
    item = {
        "id": row[0], "name": row[1], "code": row[2],
        "buy_price": row[3], "quantity": row[4], "current_price": row[5],
    }
    cost = item["buy_price"] * item["quantity"]
    market_value = item["current_price"] * item["quantity"]
    profit = market_value - cost
    profit_rate = (profit / cost) * 100 if cost else 0
    item["market_value"] = round(market_value, 2)
    item["profit"] = round(profit, 2)
    item["profit_rate"] = round(profit_rate, 2)
    return item

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
    conn.execute(
        "INSERT INTO holdings (name, code, buy_price, quantity, current_price) VALUES (?, ?, ?, ?, ?)",
        (h.name, h.code, h.buy_price, h.quantity, h.current_price),
    )
    conn.commit()
    conn.close()
    return {"message": "添加成功"}

@app.delete("/holdings/{holding_id}")
def delete_holding(holding_id: int):
    conn = sqlite3.connect(DB)
    conn.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
    conn.commit()
    conn.close()
    return {"message": "删除成功"}