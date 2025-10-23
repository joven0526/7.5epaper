// 全局变量 - 确保所有脚本都能访问
window.bleDevice = null;
window.gattServer = null;
window.epdService = null;
window.rxtxService = null;
window.epdCharacteristic = null;
window.rxtxCharacteristic = null;
window.reconnectTrys = 0;

// 蓝牙UUID配置（匹配你的设备，保持不变）
const BLE_UUIDS = {
    EPD_SERVICE: '62750001-d828-918d-fb46-b6c11c675aec',
    EPD_CHARACTERISTIC: '62750002-d828-918d-fb46-b6c11c675aec',
    RXTX_SERVICE: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    RXTX_CHARACTERISTIC: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    OPTIONAL_SERVICES: ['62750001-d828-918d-fb46-b6c11c675aec', '6e400001-b5a3-f393-e0a9-e50e24dcca9e']
};

// 工具函数（全局可用，保持不变）
function hex2bytes(hex) {
    const bytes = [];
    for (let c = 0; c < hex.length; c += 2) {
        bytes.push(parseInt(hex.substr(c, 2), 16));
    }
    return new Uint8Array(bytes);
}

function bytes2hex(data) {
    return Array.from(new Uint8Array(data)).map(b => ('0' + b.toString(16)).slice(-2)).join('');
}

function intToHex(intIn, bytes = 2) {
    let hex = intIn.toString(16).padStart(bytes * 2, '0');
    // 小端模式转换
    let result = '';
    for (let i = hex.length - 2; i >= 0; i -= 2) {
        result += hex.substr(i, 2);
    }
    return result;
}

// 蓝牙核心函数（开始修改：只搜索NRF开头设备）
function resetBluetoothVariables() {
    window.gattServer = null;
    window.epdService = null;
    window.epdCharacteristic = null;
    window.rxtxCharacteristic = null;
    window.rxtxService = null;
}

async function handleBluetoothError(error) {
    console.error('蓝牙错误:', error);
    addLog(`错误: ${error.message || error}`);
    resetBluetoothVariables();
    
    if (!window.bleDevice) return;
    
    if (window.reconnectTrys <= 5) {
        window.reconnectTrys++;
        addLog(`尝试重新连接 (${window.reconnectTrys}/5)`);
        await connectBluetooth();
    } else {
        addLog("连接失败，已终止尝试");
        window.reconnectTrys = 0;
        document.getElementById('connectbutton').style.display = 'inline-block';
        document.getElementById('disconnectbutton')?.style.display = 'none';
    }
}

async function sendCommand(cmd, withResponse = true) {
    if (!window.epdCharacteristic) {
        addLog('服务不可用，请先连接蓝牙');
        return false;
    }
    
    try {
        if (withResponse) {
            await window.epdCharacteristic.writeValueWithResponse(cmd);
        } else {
            await window.epdCharacteristic.writeValueWithoutResponse(cmd);
        }
        return true;
    } catch (error) {
        handleBluetoothError(error);
        return false;
    }
}

async function sendBufferData(value, type) {
    addLog(`开始发送图片模式:${type}, 大小 ${(value.length/2).toFixed(2)}byte`);
    const code = type === 'bwr' ? '00' : 'ff';
    const step = 200; // 调整分片大小适应MTU
    let partIndex = 0;
    
    try {
        for (let i = 0; i < value.length; i += step) {
            addLog(`正在发送第${partIndex+1}块. 起始位置: ${i/2}`);
            const chunk = `03${code}${intToHex(i / 2, 2)}${value.substring(i, i + step)}`;
            await sendCommand(hex2bytes(chunk));
            partIndex++;
        }
    } catch (error) {
        handleBluetoothError(error);
        throw error;
    }
}

function disconnectBluetooth() {
    if (window.bleDevice && window.bleDevice.gatt.connected) {
        window.bleDevice.gatt.disconnect();
    }
    resetBluetoothVariables();
    addLog('连接已断开');
    document.getElementById("connectbutton").style.display = 'inline-block';
    document.getElementById("disconnectbutton")?.style.display = 'none';
    updateButtonStatus();
}

async function preConnectBluetooth() {
    // 确保在全局作用域中可调用（与HTML的onclick绑定）
    if (window.gattServer && window.gattServer.connected) {
        disconnectBluetooth();
        return;
    }
    
    window.reconnectTrys = 0;
    
    try {
        addLog('开始搜索NRF开头的蓝牙设备...'); // 修改：提示只搜NRF设备
        // 关键修改：添加 filters 筛选「名称以NRF开头」的设备
        window.bleDevice = await navigator.bluetooth.requestDevice({ 
            optionalServices: BLE_UUIDS.OPTIONAL_SERVICES,
            filters: [
                { namePrefix: 'NRF' } // 只显示名称以NRF开头的设备（不区分大小写，如NRF52、nrf433等）
            ]
        });
        
        addLog(`找到NRF设备: ${window.bleDevice.name || '未知NRF设备'}`); // 修改：标注NRF设备
        window.bleDevice.addEventListener('gattserverdisconnected', onBluetoothDisconnected);
        await connectBluetooth();
    } catch (e) {
        addLog(`搜索NRF设备失败: ${e.message || e}`); // 修改：提示NRF设备搜索失败
        console.error('NRF蓝牙搜索错误:', e);
    }
}

function onBluetoothDisconnected() {
    addLog('NRF设备已断开连接'); // 修改：标注NRF设备
    resetBluetoothVariables();
    document.getElementById("connectbutton").style.display = 'inline-block';
    document.getElementById("disconnectbutton")?.style.display = 'none';
    updateButtonStatus();
}

async function connectRXTX() {
    try {
        window.rxtxService = await window.gattServer.getPrimaryService(BLE_UUIDS.RXTX_SERVICE);
        addLog('> 找到串口服务');
        window.rxtxCharacteristic = await window.rxtxService.getCharacteristic(BLE_UUIDS.RXTX_CHARACTERISTIC);
        addLog('> 串口服务已连接');
    } catch (error) {
        addLog(`串口服务连接失败: ${error.message || error}`);
    }
}

async function reConnectBluetooth() {
    if (!window.bleDevice) {
        addLog('请先搜索NRF设备'); // 修改：提示搜索NRF设备
        return;
    }
    
    if (window.bleDevice.gatt.connected) {
        window.bleDevice.gatt.disconnect();
    }
    
    resetBluetoothVariables();
    addLog("重新连接NRF设备中..."); // 修改：标注重新连接NRF设备
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await connectBluetooth();
}

async function connectBluetooth() {
    if (window.epdCharacteristic || !window.bleDevice) return;
    
    addLog(`正在连接NRF设备: ${window.bleDevice.name || '未知NRF设备'}`); // 修改：标注NRF设备
    
    try {
        window.gattServer = await window.bleDevice.gatt.connect();
        addLog('> 连接到NRF设备的GATT服务器'); // 修改：标注NRF设备的GATT
        
        window.epdService = await window.gattServer.getPrimaryService(BLE_UUIDS.EPD_SERVICE);
        addLog('> 找到显示服务');

        window.epdCharacteristic = await window.epdService.getCharacteristic(BLE_UUIDS.EPD_CHARACTERISTIC);
        addLog('> 显示服务已就绪');

        // 启用通知
        await window.epdCharacteristic.startNotifications();
        window.epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            const data = bytes2hex(event.target.value.buffer);
            addLog(`> 收到NRF设备数据: ${data}`); // 修改：标注NRF设备数据
        });

        // 更新按钮状态
        document.getElementById("connectbutton").style.display = 'none';
        const disconnectBtn = document.getElementById("disconnectbutton") || createDisconnectButton();
        disconnectBtn.style.display = 'inline-block';
        
        await connectRXTX();
        updateButtonStatus();
        addLog('NRF设备蓝牙连接成功，可进行操作'); // 修改：标注NRF设备连接成功
    } catch (error) {
        addLog(`NRF设备连接失败: ${error.message || error}`); // 修改：标注NRF设备连接失败
        await handleBluetoothError(error);
    }
}

// 动态创建断开按钮（如果HTML中没有，保持不变）
function createDisconnectButton() {
    const btn = document.createElement('button');
    btn.id = 'disconnectbutton';
    btn.type = 'button';
    btn.className = 'secondary';
    btn.textContent = '断开NRF设备'; // 修改：按钮文字标注NRF设备
    btn.onclick = disconnectBluetooth;
    document.getElementById('connectbutton').parentNode.appendChild(btn);
    return btn;
}

// 暴露到全局，确保HTML能调用（保持不变）
window.preConnect = preConnectBluetooth;
window.reConnect = reConnectBluetooth;
window.disconnect = disconnectBluetooth;