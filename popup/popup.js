document.addEventListener('DOMContentLoaded', async () => {
  // 获取DOM元素
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  const promptSelect = document.getElementById('prompt-select');
  const promptText = document.getElementById('prompt-text');
  const apiUrlInput = document.getElementById('api-url');
  const apiKeyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');
  const customModelInput = document.getElementById('custom-model');
  const imageModeSelect = document.getElementById('image-mode');
  const featureSwitch = document.getElementById('feature-switch');
  const resultContent = document.getElementById('result-content');
  const pasteArea = document.getElementById('paste-area');
  const previewContainer = document.getElementById('preview-container');
  const previewImage = document.getElementById('preview-image');
  const analyzeButton = document.getElementById('analyze-button');
  const cancelButton = document.getElementById('cancel-button');
  let currentImageData = null;

  // 初始化标签页切换
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.style.display = 'none');
      
      button.classList.add('active');
      document.getElementById(`${button.dataset.tab}-tab`).style.display = 'block';
    });
  });

  // 加载配置
  async function loadConfig() {
    const config = await chrome.storage.sync.get([
      'apiUrl',
      'apiKey',
      'model',
      'customModel',
      'imageMode',
      'featureEnabled'
    ]);

    apiUrlInput.value = config.apiUrl || 'https://chatapi.aisws.com';
    apiKeyInput.value = config.apiKey || '';
    modelSelect.value = config.customModel ? 'custom' : (config.model || 'gpt-4o-mini');
    customModelInput.value = config.customModel || '';
    customModelInput.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
    imageModeSelect.value = config.imageMode || 'url';
    featureSwitch.value = config.featureEnabled === false ? 'off' : 'on';
  }

  // 加载提示词
  async function loadPrompts() {
    try {
      // 获取批次信息
      const { promptBatchCount } = await chrome.storage.sync.get('promptBatchCount');
      let allPrompts = [];
      
      // 如果有批次信息，从存储中加载
      if (promptBatchCount) {
        for (let i = 0; i < promptBatchCount; i++) {
          const { [`prompts_batch_${i}`]: batch } = await chrome.storage.sync.get(`prompts_batch_${i}`);
          if (batch) {
            allPrompts = allPrompts.concat(batch);
          }
        }
      }

      // 如果没有存储的提示词，使用默认提示词并保存
      if (!allPrompts.length) {
        allPrompts = DEFAULT_PROMPTS;
        // 将提示词分批存储
        const batchSize = 5;
        const promptBatches = [];
        
        for (let i = 0; i < allPrompts.length; i += batchSize) {
          promptBatches.push(allPrompts.slice(i, i + batchSize));
        }

        // 保存所有批次
        for (let i = 0; i < promptBatches.length; i++) {
          await chrome.storage.sync.set({
            [`prompts_batch_${i}`]: promptBatches[i]
          });
        }

        // 保存批次信息和当前选择
        await chrome.storage.sync.set({
          promptBatchCount: promptBatches.length,
          currentPrompt: allPrompts[0].id,
          currentPromptText: allPrompts[0].text
        });
      }

      // 获取当前选中的提示词
      const { currentPrompt } = await chrome.storage.sync.get('currentPrompt');

      // 更新选择器
      promptSelect.innerHTML = '';
      allPrompts.forEach(prompt => {
        const option = document.createElement('option');
        option.value = prompt.id;
        option.textContent = prompt.name;
        if (prompt.id === currentPrompt) {
          option.selected = true;
          promptText.value = prompt.text || '';
        }
        promptSelect.appendChild(option);
      });

      // 更新删除按钮状态
      const deleteButton = document.getElementById('delete-prompt');
      if (deleteButton) {
        const isDefaultPrompt = allPrompts.find(p => p.id === promptSelect.value)?.id === 'default';
        deleteButton.disabled = isDefaultPrompt;
        deleteButton.style.opacity = isDefaultPrompt ? '0.5' : '1';
      }

      return allPrompts;
    } catch (error) {
      console.error('加载提示词时出错:', error);
      return [];
    }
  }

  // 保存配置
  document.getElementById('save-config').addEventListener('click', async () => {
    const config = {
      apiUrl: apiUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value === 'custom' ? customModelInput.value.trim() : modelSelect.value,
      customModel: modelSelect.value === 'custom' ? customModelInput.value.trim() : '',
      imageMode: imageModeSelect.value,
      featureEnabled: featureSwitch.value === 'on'
    };

    try {
      await chrome.storage.sync.set(config);
      
      // 通知内容脚本功能状态变化
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'FEATURE_STATE_CHANGED',
          enabled: config.featureEnabled
        });
      }
      
      alert('配置已保存！');
    } catch (error) {
      console.error('保存配置时出错:', error);
      alert('保存失败，请重试！');
    }
  });

  // 监听模型选择变化
  modelSelect.addEventListener('change', () => {
    customModelInput.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
  });

  // 监听提示词选择变化
  promptSelect.addEventListener('change', async () => {
    try {
      const { promptBatchCount } = await chrome.storage.sync.get('promptBatchCount');
      let allPrompts = [];
      
      for (let i = 0; i < promptBatchCount; i++) {
        const { [`prompts_batch_${i}`]: batch } = await chrome.storage.sync.get(`prompts_batch_${i}`);
        if (batch) {
          allPrompts = allPrompts.concat(batch);
        }
      }

      const selectedPrompt = allPrompts.find(p => p.id === promptSelect.value);
      if (selectedPrompt) {
        promptText.value = selectedPrompt.text || '';
        await chrome.storage.sync.set({
          currentPrompt: selectedPrompt.id,
          currentPromptText: selectedPrompt.text
        });
      }

      // 更新删除按钮状态
      const deleteButton = document.getElementById('delete-prompt');
      if (deleteButton) {
        const isDefaultPrompt = selectedPrompt?.id === 'default';
        deleteButton.disabled = isDefaultPrompt;
        deleteButton.style.opacity = isDefaultPrompt ? '0.5' : '1';
      }
    } catch (error) {
      console.error('切换提示词时出错:', error);
    }
  });

  // 保存提示词
  document.getElementById('save-prompt').addEventListener('click', async () => {
    if (promptSelect.value) {
      try {
        const batchIndex = Math.floor(promptSelect.selectedIndex / 5);
        const { [`prompts_batch_${batchIndex}`]: currentBatch } = 
          await chrome.storage.sync.get(`prompts_batch_${batchIndex}`);
        
        if (currentBatch) {
          const promptIndex = promptSelect.selectedIndex % 5;
          if (currentBatch[promptIndex]) {
            // 更新提示词文本
            currentBatch[promptIndex].text = promptText.value;
            
            // 保存更新后的批次
            await chrome.storage.sync.set({
              [`prompts_batch_${batchIndex}`]: currentBatch
            });

            // 更新当前选择
            await chrome.storage.sync.set({
              currentPrompt: promptSelect.value,
              currentPromptText: promptText.value
            });

            alert('提示词已保存！');
          }
        }
      } catch (error) {
        console.error('保存提示词时出错:', error);
        alert('保存失败，请重试！');
      }
    }
  });

  // 新建提示词
  document.getElementById('new-prompt').addEventListener('click', async () => {
    try {
      const promptName = prompt('请输入提示词名称：');
      if (!promptName) return;

      const newId = `custom_${Date.now()}`;
      const newPrompt = {
        id: newId,
        name: promptName,
        text: ''  // 初始为空
      };
      
      // 获取现有的提示词
      const currentPrompts = await loadPrompts();
      currentPrompts.push(newPrompt);

      // 重新保存所有批次
      const batchSize = 5;
      const promptBatches = [];
      
      for (let i = 0; i < currentPrompts.length; i += batchSize) {
        promptBatches.push(currentPrompts.slice(i, i + batchSize));
      }

      // 保存新的批次
      for (let i = 0; i < promptBatches.length; i++) {
        await chrome.storage.sync.set({
          [`prompts_batch_${i}`]: promptBatches[i]
        });
      }

      // 更新批次计数和当前选择
      await chrome.storage.sync.set({
        promptBatchCount: promptBatches.length,
        currentPrompt: newId
      });

      // 重新加载提示词列表并选中新建的提示词
      await loadPrompts();
      promptSelect.value = newId;
      promptText.value = '';  // 清空文本框等待输入
      promptText.focus();  // 焦到文本框
      
    } catch (error) {
      console.error('新建提示词时出错:', error);
      alert('新建失败，请重试！');
    }
  });

  // 在新窗口中打开
  document.getElementById('open-window').addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html'),
      type: 'popup',
      width: 800,
      height: 600
    });
  });

  // 添加初始化函数，用于恢复上一次的分析状态
  async function restoreLastAnalysis() {
    try {
      const {
        lastImageData,
        lastAnalysisResult,
        isAnalyzing
      } = await chrome.storage.local.get([
        'lastImageData',
        'lastAnalysisResult',
        'isAnalyzing'
      ]);

      if (lastImageData) {
        handleImage(lastImageData, isAnalyzing);
      }

      if (lastAnalysisResult) {
        resultContent.innerHTML = lastAnalysisResult;
      }
    } catch (error) {
      console.error('恢复上次分析状态时出错:', error);
    }
  }

  // 修改 handleImage 函数，保存图片数据
  function handleImage(imageData, isAnalyzing = false) {
    currentImageData = imageData;
    previewImage.src = imageData.startsWith('data:') ? imageData : imageData;
    pasteArea.style.display = 'block';
    previewContainer.style.display = 'block';
    
    // 保存图片数据
    chrome.storage.local.set({ lastImageData: imageData });
    
    // 如果是正在分析的图片，更新按钮状态
    if (isAnalyzing) {
      analyzeButton.classList.add('analyzing');
      analyzeButton.textContent = '分析中...';
      cancelButton.style.display = 'none';
      chrome.storage.local.set({ isAnalyzing: true });
    }
    
    // 如果有分析结果，滚动到预览区域
    if (resultContent.innerHTML) {
      previewContainer.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // 修改文件选择处理函数
  function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        handleImage(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  }

  // 修改粘贴事件处理
  pasteArea.addEventListener('paste', async (e) => {
    e.preventDefault();
    console.log('粘贴事件触发');
    const items = e.clipboardData.items;
    console.log('剪贴板项目:', items);
    
    for (let item of items) {
      console.log('处理项目类型:', item.type);
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        console.log('获取到图片文件:', file);
        const reader = new FileReader();
        reader.onload = (e) => {
          console.log('图片读取完成');
          handleImage(e.target.result);
        };
        reader.onerror = (error) => {
          console.error('读取文件时出错:', error);
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  });

  // 保 paste-area 可以获得焦点
  pasteArea.tabIndex = 0;

  // 当点击 paste-area 时给予其焦点
  pasteArea.addEventListener('click', () => {
    pasteArea.focus();
    // 保留现有的文件选择功能
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = handleFileSelect;
    input.click();
  });

  // 添加文档级别的粘贴事件监听
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (let item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (e) => {
          handleImage(e.target.result);
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  });

  // 添加分析按钮事件处理
  analyzeButton.addEventListener('click', async () => {
    if (!currentImageData || analyzeButton.classList.contains('analyzing')) return;
    
    try {
      // 添加分析中状态
      analyzeButton.classList.add('analyzing');
      analyzeButton.textContent = '分析中...';
      resultContent.classList.add('loading');
      resultContent.innerHTML = ''; // 清空之前的结果
      // 隐藏取消按钮
      cancelButton.style.display = 'none';
      
      chrome.runtime.sendMessage({
        type: 'ANALYZE_IMAGE',
        data: {
          isBase64: true,
          image: currentImageData,
          prompt: promptText.value
        }
      });
    } catch (error) {
      console.error('分析图片时出错:', error);
      alert('分析失败，请重试！');
      // 恢复按钮状态
      analyzeButton.classList.remove('analyzing');
      analyzeButton.textContent = '开始分析';
      resultContent.classList.remove('loading');
      // 恢复显示取消按钮
      cancelButton.style.display = 'block';
    }
  });

  // 添加取消按钮事件处理
  cancelButton.addEventListener('click', () => {
    currentImageData = null;
    previewImage.src = '';
    previewContainer.style.display = 'none';
    pasteArea.style.display = 'block';
    resultContent.innerHTML = '';
    // 重置分析按钮状态
    analyzeButton.classList.remove('analyzing');
    analyzeButton.textContent = '开始分析';
    // 清除存储的数据
    chrome.storage.local.remove([
      'lastImageData',
      'lastAnalysisResult',
      'isAnalyzing'
    ]);
  });

  // 监听分析结果
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ANALYSIS_RESULT' || message.type === 'ANALYSIS_ERROR') {
      // 移除加载状态
      if (analyzeButton) {
        analyzeButton.classList.remove('analyzing');
        analyzeButton.textContent = '开始分析';
      }
      resultContent.classList.remove('loading');
      // 恢复显示取消按钮
      if (cancelButton) {
        cancelButton.style.display = 'block';
      }
      // 显示粘贴区域，但保持预览图片可见
      pasteArea.style.display = 'block';
      previewContainer.style.display = 'block';
      
      let resultHtml;
      if (message.type === 'ANALYSIS_RESULT') {
        resultHtml = marked.parse(message.data);
      } else {
        resultHtml = `<div class="error">分析失败: ${message.error}</div>`;
      }
      
      resultContent.innerHTML = resultHtml;
      // 保存分析结果
      chrome.storage.local.set({
        lastAnalysisResult: resultHtml,
        isAnalyzing: false
      });
      
    } else if (message.type === 'ANALYSIS_START') {
      // 添加加载状态
      resultContent.classList.add('loading');
      resultContent.innerHTML = '';
      chrome.storage.local.set({ lastAnalysisResult: '' });
      
      // 如果是来自 content.js 的分析请求，设置预览图片
      chrome.storage.local.get(['currentImageUrl'], function(result) {
        if (result.currentImageUrl) {
          handleImage(result.currentImageUrl, true);
        }
      });
      
      // 切换到分析结果标签页
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.style.display = 'none');
      
      const resultTab = document.querySelector('[data-tab="result"]');
      resultTab.classList.add('active');
      document.getElementById('result-tab').style.display = 'block';
    } else if (message.type === 'SWITCH_TO_RESULT_TAB') {
      // 切换到分析结果标签页
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.style.display = 'none');
      
      const resultTab = document.querySelector('[data-tab="result"]');
      if (resultTab) {
        resultTab.classList.add('active');
        document.getElementById('result-tab').style.display = 'block';
      }
    }
  });

  // 添加拖放支持
  pasteArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    pasteArea.classList.add('dragover');
  });

  pasteArea.addEventListener('dragleave', () => {
    pasteArea.classList.remove('dragover');
  });

  pasteArea.addEventListener('drop', (e) => {
    e.preventDefault();
    pasteArea.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        handleImage(e.target.result);
      };
      reader.readAsDataURL(files[0]);
    }
  });

  // 删除提示词的处理函数
  document.getElementById('delete-prompt').addEventListener('click', async () => {
    if (!promptSelect.value) return;

    try {
      // 获取批次信息
      const { promptBatchCount } = await chrome.storage.sync.get('promptBatchCount');
      if (!promptBatchCount) return;

      let allPrompts = [];
      // 从所有批次中加载提示词
      for (let i = 0; i < promptBatchCount; i++) {
        const { [`prompts_batch_${i}`]: batch } = await chrome.storage.sync.get(`prompts_batch_${i}`);
        if (batch) {
          allPrompts = allPrompts.concat(batch);
        }
      }

      // 检查是否只剩最后一个提示词
      if (allPrompts.length <= 1) {
        alert('至少需要保留一个提示词！');
        return;
      }

      // 确认删除
      if (!confirm('确定要删除这个提示词吗？')) return;

      // 过滤掉要删除的提示词
      const updatedPrompts = allPrompts.filter(p => p.id !== promptSelect.value);

      // 重新分批存储
      const batchSize = 5;
      const promptBatches = [];
      
      for (let i = 0; i < updatedPrompts.length; i += batchSize) {
        promptBatches.push(updatedPrompts.slice(i, i + batchSize));
      }

      // 清除旧的批次
      for (let i = 0; i < promptBatchCount; i++) {
        await chrome.storage.sync.remove(`prompts_batch_${i}`);
      }

      // 保存新的批次
      for (let i = 0; i < promptBatches.length; i++) {
        await chrome.storage.sync.set({
          [`prompts_batch_${i}`]: promptBatches[i]
        });
      }

      // 更新批次计数
      await chrome.storage.sync.set({
        promptBatchCount: promptBatches.length
      });

      // 如果删除的是当前选中的提示词，选择第一个可用的提示词
      if (updatedPrompts.length > 0) {
        await chrome.storage.sync.set({
          currentPrompt: updatedPrompts[0].id,
          currentPromptText: updatedPrompts[0].text
        });
      }

      // 重新加载提示词列表
      await loadPrompts();

      // 更新删除按钮状态
      const deleteButton = document.getElementById('delete-prompt');
      if (deleteButton) {
        const isDefaultPrompt = updatedPrompts.find(p => p.id === promptSelect.value)?.id === 'default';
        deleteButton.disabled = isDefaultPrompt;
        deleteButton.style.opacity = isDefaultPrompt ? '0.5' : '1';
      }

      alert('提示词已删除');

    } catch (error) {
      console.error('删除提示词时出错:', error);
      alert('删除提示词失败，请重试！');
    }
  });

  try {
    const { apiUrl, apiKey } = await chrome.storage.sync.get(['apiUrl', 'apiKey']);
    if (apiUrl) {
      apiUrlInput.value = apiUrl;
    }
    if (apiKey) {
      apiKeyInput.value = apiKey;
    }
  } catch (error) {
    console.error('加载设置时出错:', error);
  }

  // 初始化
  await loadConfig();
  await loadPrompts();

  // 修改粘贴区域的样式，使其在有预览图片时仍然可见
  const style = document.createElement('style');
  style.textContent = `
    .paste-area {
      margin-bottom: 16px;
    }
    
    .preview-container {
      margin-bottom: 16px;
    }
    
    .result-section {
      display: flex;
      flex-direction: column;
    }
  `;
  document.head.appendChild(style);

  // 在初始化时恢复上次的分析状态
  await restoreLastAnalysis();
});