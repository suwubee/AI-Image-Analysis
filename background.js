// 导入配置文件
importScripts('shared/config.js');

// 添加 analyzeImage 函数
async function analyzeImage(imageUrl, customPrompt) {
  try {
    console.log('获取配置信息...');
    const storage = await chrome.storage.sync.get(['apiUrl', 'apiKey', 'model', 'prompts', 'currentPrompt', 'imageMode']);
    
    if (!storage.apiKey) {
      throw new Error('请先配置 API Key');
    }

    const prompt = customPrompt || storage.currentPromptText || '请全面分析这张图片的内容。首先，描述图片中出现的主要元素，如人物、动物、物品等。接着，解释这些元素之间的关系以及它们在整体画面中的布局和互动。最后，总结图片传达的主要信息或主题。请用中文回复。';
    console.log('使用提示词:', prompt);

    // 根据图片模式处理图片数据
    let imageData;
    if (storage.imageMode === 'url') {
      // 直接使用 URL
      imageData = {
        type: 'image_url',
        image_url: {
          url: imageUrl
        }
      };
      console.log('使用 URL 模式处理图片');
    } else {
      // 使用 Base64 模式
      console.log('获取图片数据并转换为 Base64...');
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const base64data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
      imageData = {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64data}`
        }
      };
    }

    const apiUrl = `${(storage.apiUrl || 'https://chatapi.aisws.com')
      .trim()                    // 移除首尾空格
      .replace(/\/+$/, '')      // 移除末尾斜杠
      .replace(/@+/, '')        // 移除 @ 符号
      .replace(/([^:]\/)\/+/g, '$1') // 移除中间的重复斜杠
    }/v1/chat/completions`;
    console.log('准备发送API请求到:', apiUrl);
    
    const requestBody = {
      model: storage.model || 'gpt-4-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            },
            imageData
          ]
        }
      ]
    };
    
    console.log('发送API请求，使用模型:', requestBody.model);
    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${storage.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    console.log('收到API响应，状态码:', apiResponse.status);
    if (!apiResponse.ok) {
      const error = await apiResponse.json();
      throw new Error(error.error?.message || 'API 请求失败');
    }

    const data = await apiResponse.json();
    console.log('API响应数据已解析');
    
    if (!data.choices || !data.choices[0]) {
      throw new Error('无效的 API 响应');
    }

    // 发送分析结果到 popup
    chrome.runtime.sendMessage({
      type: 'ANALYSIS_RESULT',
      data: data.choices[0].message.content
    });

    // 更新状态为已完成
    chrome.storage.local.set({ 
      analysisStatus: 'completed',
      lastAnalysisResult: data.choices[0].message.content
    });

    console.log('分析完成，结果已保存');
    return data;

  } catch (error) {
    console.error('分析过程出错:', error);
    // 发送错误消息到 popup
    chrome.runtime.sendMessage({
      type: 'ANALYSIS_ERROR',
      error: error.message
    });
    // 更新状态为失败
    chrome.storage.local.set({ 
      analysisStatus: 'failed',
      analysisError: error.message
    });
    throw error;
  }
}

// 消息监听器
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_IMAGE') {
    console.log('收到图片分析请求');
    
    // 区分是网页图片还是粘贴的 base64 图片
    if (message.shouldOpenPopup) {
      console.log('网页图片分析模式');
      
      // 保存当前要分析的图片URL并设置状态为分析中
      chrome.storage.local.set({ 
        currentImageUrl: message.imageUrl,
        analysisStatus: 'analyzing'
      }, async () => {
        console.log('已保存分析状态');
        
        try {
          // 检查当前窗口状态
          const windows = await chrome.windows.getAll();
          const currentWindow = await chrome.windows.getCurrent();
          let popupAlreadyFocused = false;

          // 检查扩展的 popup ��否已经在当前窗口的焦点上
          if (currentWindow && currentWindow.focused) {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('chrome-extension://')) {
              popupAlreadyFocused = true;
            }
          }

          // 如果 popup 不在焦点上，尝试打开它
          if (!popupAlreadyFocused) {
            await chrome.action.openPopup();
          }
          
          // 使用传入的提示词或默认提示词
          const prompt = message.prompt || '请描述这张图片的内容';
          
          // 发送分析开始的消息
          chrome.runtime.sendMessage({
            type: 'ANALYSIS_START',
            imageUrl: message.imageUrl,
            prompt: prompt  // 添加提示词
          });

          // 修改 analyzeImage 调用，传入提示词
          await analyzeImage(message.imageUrl, prompt);
          console.log('分析完成');
          
          // 更新按钮状态
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'ANALYSIS_COMPLETE',
            success: true
          });
        } catch (error) {
          console.error('分析失败:', error);
          // 发送错误消息到内容脚本
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'ANALYSIS_COMPLETE',
            success: false,
            error: error.message
          });
          // 发送错误消息到弹窗
          chrome.runtime.sendMessage({
            type: 'ANALYSIS_ERROR',
            error: error.message
          });
        }
      });
    } else if (message.data && message.data.isBase64) {
      // 粘贴图片模式：始终使用 base64
      console.log('粘贴图片分析模式（强制使用 Base64）');
      
      (async () => {
        try {
          const storage = await chrome.storage.sync.get(['apiUrl', 'apiKey', 'model']);
          
          if (!storage.apiKey) {
            throw new Error('请先配置 API Key');
          }

          const apiUrl = `${storage.apiUrl || 'https://chatapi.aisws.com'}/v1/chat/completions`;
          console.log('准备发送 API 请求');
          
          const requestBody = {
            model: storage.model || 'gpt-4-vision-preview',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: message.data.prompt },
                  {
                    type: 'image_url',
                    image_url: { url: message.data.image }
                  }
                ]
              }
            ]
          };

          console.log('发送粘贴图片分析请求');
          const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${storage.apiKey}`
            },
            body: JSON.stringify(requestBody)
          });

          if (!apiResponse.ok) {
            const error = await apiResponse.json();
            throw new Error(error.error?.message || 'API 请求失败');
          }

          const data = await apiResponse.json();
          console.log('粘贴图片分析完成');
          
          chrome.runtime.sendMessage({
            type: 'ANALYSIS_RESULT',
            data: data.choices[0].message.content
          });

        } catch (error) {
          console.error('粘贴图片分析失败:', error);
          chrome.runtime.sendMessage({
            type: 'ANALYSIS_ERROR',
            error: error.message
          });
        }
      })();
    }
    
    // 立即发送响应
    sendResponse({ received: true });
    return true;  // 保持消息通道打开
  }
});

// 监听安装事件
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    // 设置默认提示词 - 分批存储
    const defaultPrompts = await chrome.storage.sync.get('prompts');
    if (!defaultPrompts.prompts) {
      // 将提示词分成多个批次存储
      const promptBatches = [];
      const batchSize = 5; // 每批存储5个提示词
      
      for (let i = 0; i < DEFAULT_PROMPTS.length; i += batchSize) {
        promptBatches.push(DEFAULT_PROMPTS.slice(i, i + batchSize));
      }

      // 存储提示词批次
      for (let i = 0; i < promptBatches.length; i++) {
        await chrome.storage.sync.set({
          [`prompts_batch_${i}`]: promptBatches[i]
        });
      }

      // 存储批次信息
      await chrome.storage.sync.set({
        promptBatchCount: promptBatches.length,
        currentPrompt: 'default',
        imageMode: 'url',
        featureEnabled: true
      });
    }
  }
});