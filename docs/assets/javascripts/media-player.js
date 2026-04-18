(function () {
  function formatUrl(url) {
    if (!url) return url;
    if (!url.startsWith('http')) {
      var defaultPrefix = 'https://box.hdcxb.net/d/503';
      return url.startsWith('/') ? defaultPrefix + url : defaultPrefix + '/' + url;
    }
    return url;
  }

  function renderMediaPlayer(mediaData, h1) {
    // 防止重复插入
    if (document.getElementById('lsyh-media-plugin-container')) {
      return;
    }

    var videoUrl = formatUrl(mediaData.video);
    var audioUrl = formatUrl(mediaData.audio);

    var hasVideo = !!videoUrl;
    var hasAudio = !!audioUrl;

    if (!hasVideo && !hasAudio) {
      return; 
    }

    var container = document.createElement('div');
    container.id = 'lsyh-media-plugin-container';
    container.style.marginBottom = '20px';
    container.style.marginTop = '15px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '25px';

    var btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '20px';
    btnContainer.style.flexWrap = 'wrap';
    
    // 播放和关闭图标
    var playIcon = '<span class="twemoji" style="margin-right: 8px;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M8 5.14v14l11-7-11-7Z"/></svg></span>';
    var closeIcon = '<span class="twemoji" style="margin-right: 8px;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg></span>';
    
    // 视频播放按钮（如果既有视频又有音频，视频按钮为主色）
    var btnVideo = document.createElement('button');
    btnVideo.className = 'md-button md-button--primary';
    btnVideo.innerHTML = playIcon + '播放视频';
    if (!hasVideo) btnVideo.style.display = 'none';

    // 音频播放按钮（如果有视频，音频按钮为次级样式，否则为主色）
    var btnAudio = document.createElement('button');
    btnAudio.className = hasVideo ? 'md-button' : 'md-button md-button--primary';
    btnAudio.innerHTML = playIcon + '播放音频';
    if (!hasAudio) btnAudio.style.display = 'none';

    // 关闭播放按钮
    var btnClose = document.createElement('button');
    btnClose.className = 'md-button';
    btnClose.innerHTML = closeIcon + '关闭播放';
    btnClose.style.display = 'none';

    btnContainer.appendChild(btnVideo);
    btnContainer.appendChild(btnAudio);
    btnContainer.appendChild(btnClose);

    var playerWrapper = document.createElement('div');
    playerWrapper.style.display = 'none';
    playerWrapper.style.width = '100%';
    playerWrapper.style.maxWidth = '800px';

    function loadMedia(type) {
      playerWrapper.style.display = 'block';
      playerWrapper.innerHTML = ''; 
      
      var mediaElement;
      if (type === 'video') {
        mediaElement = document.createElement('video');
        mediaElement.src = videoUrl;
        mediaElement.style.width = '100%';
        mediaElement.style.borderRadius = '4px';
        // 兼容苹果全屏与非全屏 (内联) 播放的必需属性
        mediaElement.setAttribute('playsinline', '');
        mediaElement.setAttribute('webkit-playsinline', '');
        
        btnVideo.style.display = 'none';
        if (hasAudio) btnAudio.style.display = 'block';
      } else {
        mediaElement = document.createElement('audio');
        mediaElement.src = audioUrl;
        mediaElement.style.width = '100%';
        
        btnAudio.style.display = 'none';
        if (hasVideo) btnVideo.style.display = 'block';
      }
      
      mediaElement.controls = true;
      mediaElement.autoplay = true;
      
      playerWrapper.appendChild(mediaElement);
      btnClose.style.display = 'block';
    }

    function closeMedia() {
      playerWrapper.innerHTML = '';
      playerWrapper.style.display = 'none';
      btnClose.style.display = 'none';
      if (hasVideo) btnVideo.style.display = 'block';
      if (hasAudio) btnAudio.style.display = 'block';
    }

    btnVideo.addEventListener('click', function() { loadMedia('video'); });
    btnAudio.addEventListener('click', function() { loadMedia('audio'); });
    btnClose.addEventListener('click', closeMedia);

    container.appendChild(playerWrapper);
    container.appendChild(btnContainer);

    // 插入到 h1 之后
    h1.parentNode.insertBefore(container, h1.nextSibling);
  }

  function initMediaPlayer() {
    var h1s = document.getElementsByTagName('h1');
    if (h1s.length === 0) return;
    
    var h1 = h1s[0];
    // 获取标题文本，并移除可能由锚点生成的 `#` 号及首尾空格
    var titleText = (h1.textContent || h1.innerText).replace(/#$/, '').replace(/¶$/, '').trim();

    // 如果全局已经有缓存的对应数据，直接渲染
    if (window.ArticleMediaList) {
      var mediaData = window.ArticleMediaList[titleText];
      if (mediaData) renderMediaPlayer(mediaData, h1);
      return;
    }

    // 否则发起请求，获取并缓存数据
    fetch('https://zb.196212.xyz/api/collections/objects/records/puti-media')
      .then(function(res) { return res.json(); })
      .then(function(resData) {
        if (resData && resData.data) {
          window.ArticleMediaList = resData.data; // 缓存在全局变量
          var mData = window.ArticleMediaList[titleText];
          if (mData) {
            renderMediaPlayer(mData, h1);
          }
        }
      })
      .catch(function(err) {
        console.error('Failed to fetch media list:', err);
      });
  }

  // 页面加载或前端路由切换时执行
  document.addEventListener("DOMContentLoaded", initMediaPlayer);
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(initMediaPlayer);
  }
})();
