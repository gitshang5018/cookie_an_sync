import asyncio
import json
from datetime import datetime
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()

# 允许跨域请求（插件访问必需）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 存储最新数据的全局变量
latest_data = {
    "cookies": None,
    "domain": None,
    "timestamp": None
}

# 活跃的 WebSocket 客户端集合
active_connections: set[WebSocket] = set()

@app.get("/status")
async def get_status():
    return {
        "status": "running",
        "lastUpdate": latest_data["timestamp"],
        "domain": latest_data["domain"]
    }

@app.post("/update")
async def update_cookies(request: Request):
    global latest_data
    try:
        data = await request.json()
        latest_data["cookies"] = data.get("cookies")
        latest_data["domain"] = data.get("domain")
        latest_data["timestamp"] = datetime.now().strftime("%H:%M:%S")
        
        print(f"[{latest_data['timestamp']}] 收到更新: 域名 [{latest_data['domain']}]，共 {len(latest_data['cookies'])} 个 Cookie")
        
        # 广播给所有连接的客户端
        if active_connections:
            message = json.dumps({
                "type": "UPDATE_COOKIES",
                "domain": latest_data["domain"],
                "cookies": latest_data["cookies"],
                "timestamp": latest_data["timestamp"]
            })
            # 异步向所有客户端发送，忽略发送失败的客户端
            tasks = [asyncio.create_task(client.send_text(message)) for client in active_connections]
            if tasks:
                await asyncio.wait(tasks)
            
        return {"status": "success", "message": "Cookies updated and broadcasted"}
    except Exception as e:
        print(f"处理失败: {e}")
        return {"status": "error", "message": str(e)}

@app.websocket("/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    print(f"(+) 客户端已连接. 当前总数: {len(active_connections)}")
    
    # 如果已有缓存，连上后立即推送一次
    if latest_data["cookies"]:
        try:
            await websocket.send_text(json.dumps({
                "type": "INIT_COOKIES",
                "domain": latest_data["domain"],
                "cookies": latest_data["cookies"],
                "timestamp": latest_data["timestamp"]
            }))
        except Exception:
            pass
        
    try:
        while True:
            # 接收消息以保持连接活跃 (心跳)
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        print(f"(-) 客户端已断开. 当前总数: {len(active_connections)}")
    except Exception as e:
        print(f"WebSocket 异常: {e}")
        if websocket in active_connections:
            active_connections.remove(websocket)

if __name__ == "__main__":
    print("==========================================")
    print("   Cookie 同步中转站 (Python 版) 已启动")
    print("   运行地址: http://0.0.0.0:3000")
    print("==========================================")
    uvicorn.run(app, host="0.0.0.0", port=3000, log_level="info")
