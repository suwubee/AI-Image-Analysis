let featureEnabled = true; // 默认开启

function createAnalyzeButton() {
  const button = document.createElement('div');
  button.className = 'ai-analyze-button';
  button.textContent = 'AI 分析';
  return button;
}

// 添加消息监听器来处理分析完成的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYSIS_COMPLETE' && currentButton) {
    if (message.success) {
      updateButtonState(currentButton, 'success');
    } else {
      updateButtonState(currentButton, 'error');
      console.error('分析错误:', message.error);
    }
  }
});

// 添加消息监听器来处理功能开关状态变化
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FEATURE_STATE_CHANGED') {
    featureEnabled = message.enabled;
    // 如果功能被禁用，移除所有现有的按钮
    if (!featureEnabled && currentButton) {
      currentButton.remove();
      currentButton = null;
    }
  }
});

let currentButton = null;  // 移到全局作用域
let currentImg = null;     // 移到全局作用域

// 在初始化获取功能状态
chrome.storage.sync.get(['featureEnabled'], function(result) {
  featureEnabled = result.featureEnabled !== false; // 默认为 true
});

function handleImageHover() {
  document.addEventListener('mouseover', (e) => {
    // 如果功能被禁用，直接返回
    if (!featureEnabled) return;

    if (e.target.tagName === 'IMG') {
      const img = e.target;
      
      // 检查图片尺寸
      const imgRect = img.getBoundingClientRect();
      if (imgRect.width < 50 || imgRect.height < 50) {
        return; // 忽略太小的图片
      }
      
      // 更新当前图片引用
      currentImg = img;
      
      // 如果按钮不存在或不是当前图片的按钮，创建新按钮
      if (!currentButton || currentButton.dataset.imgSrc !== img.src) {
        // 移除旧按钮（如果存在）
        if (currentButton) {
          currentButton.remove();
        }
        
        currentButton = createAnalyzeButton();
        currentButton.dataset.imgSrc = img.src;
        document.body.appendChild(currentButton);
        // 只在创建按钮时更新一次位置
        updateButtonPosition(currentButton, img);
      }
      
      currentButton.style.display = 'block';
      
      // 修改按钮点击事件处理
      currentButton.onclick = async (event) => {
        event.stopPropagation();
        
        if (currentButton.dataset.analyzing === 'true') {
          console.log('分析已在进行中，请等待...');
          return;
        }
        
        console.log('点击分析按钮，图片URL:', img.src);
        currentButton.dataset.analyzing = 'true';
        currentButton.textContent = '分析中...';
        currentButton.classList.add('analyzing');
        currentButton.style.cursor = 'not-allowed';
        
        try {
          // 添加错误检查
          if (!chrome.runtime?.id) {
            throw new Error('扩展已重新加载，请刷新页面');
          }

          // 获取当前选择的提示词
          const { currentPromptText } = await chrome.storage.sync.get('currentPromptText');

          // 发送消息前检查扩展状态
          const response = await chrome.runtime.sendMessage({ 
            type: 'ANALYZE_IMAGE',
            shouldOpenPopup: true,
            imageUrl: img.src,
            prompt: currentPromptText  // 添加提示词
          }).catch(error => {
            // 如果扩展上下文无效，提示用户刷新页面
            if (error.message.includes('Extension context invalidated')) {
              throw new Error('扩展已更新，请刷新页面以继续使用');
            }
            throw error;
          });

          console.log('分析请求已发送');
          
        } catch (error) {
          console.error('处理图片时出错:', error);
          updateButtonState(currentButton, 'error');
          
          // 显示错误提示
          if (error.message.includes('刷新页面')) {
            alert(error.message);
            // 可选：自动刷新页面
            // window.location.reload();
          }
        }
      };
    }
  });

  // 移除mousemove事件监听器
  // 只在滚动时更新按钮位置
  window.addEventListener('scroll', () => {
    if (!featureEnabled) return;
    if (currentImg && currentButton) {
      updateButtonPosition(currentButton, currentImg);
    }
  });

  // 处理鼠标移出事件
  document.addEventListener('mouseout', (e) => {
    if (!featureEnabled) return;
    if (e.target.tagName === 'IMG') {
      const img = e.target;
      const relatedTarget = e.relatedTarget;
      
      // 检查鼠标是否移动到按钮上
      if (currentButton && 
          relatedTarget !== currentButton && 
          !currentButton.contains(relatedTarget) &&
          !img.contains(relatedTarget)) {
        // 只在非分析状态下隐藏按钮
        if (!currentButton.dataset.analyzing) {
          currentButton.style.display = 'none';
        }
      }
    }
  });
}

// 更新按钮位置的辅助函数
function updateButtonPosition(button, img) {
  const imgRect = img.getBoundingClientRect();
  
  // 计算按钮位置，距离图片右上角 10px
  let top = imgRect.top + 10;
  let left = imgRect.right - button.offsetWidth - 10;
  
  // 确保按钮不会超出视口
  if (left + button.offsetWidth > window.innerWidth) {
    left = window.innerWidth - button.offsetWidth - 10;
  }
  if (top < 0) {
    top = 10;
  }
  if (top + button.offsetHeight > window.innerHeight) {
    top = window.innerHeight - button.offsetHeight - 10;
  }
  
  button.style.top = `${top}px`;
  button.style.left = `${left}px`;
}

// 添加辅助函数来更新按钮状态
function updateButtonState(button, state) {
  console.log('更新按钮状态:', state);
  
  // 检查按钮是否仍然存在
  if (!button || !document.contains(button)) {
    console.log('按钮已不存在，跳过状态更新');
    return;
  }
  
  button.dataset.analyzing = 'false';
  button.style.cursor = 'pointer';
  
  switch (state) {
    case 'success':
      button.textContent = '已分析';
      button.classList.remove('analyzing', 'error');
      button.classList.add('success');
      break;
    case 'error':
      button.textContent = '分析失败';
      button.classList.remove('analyzing', 'success');
      button.classList.add('error');
      // 添加重试功能
      button.onclick = (e) => {
        e.stopPropagation();
        button.textContent = 'AI 分析';
        button.classList.remove('error');
        button.dataset.analyzing = 'false';
      };
      break;
  }
}

// 确保事件监听器只添加一次
if (!window.imageHoverInitialized) {
  handleImageHover();
  window.imageHoverInitialized = true;
}

// 添加页面卸载前的清理
window.addEventListener('beforeunload', () => {
  if (currentButton && document.contains(currentButton)) {
    currentButton.remove();
  }
});