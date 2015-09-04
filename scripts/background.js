var iconUrl = chrome.extension.getURL('img/colors.png');

function notify(title, message) {
	chrome.notifications.create('VKFotkiNotification', {
		type: 'basic',
		iconUrl: iconUrl,
		title: title,
		message: message
	});
}

var VKFotki = {

	init: function() {
		console.log('VKFotki: start backend extension');

		// Create context menu
		this.createContextMenu();
	},

	createContextMenu: function() {
		console.log('VKFotki: create context menu');

		chrome.contextMenus.removeAll();
		chrome.contextMenus.create({
			title: "Загрузить во ВКонтакте",
			contexts: ["image"],
			onclick: this.onContextMenuClick
		});
	},

	onContextMenuClick: function(info, tab) {
		// Get an info about clicked picture and page
		var image = {
			itemId: info.menuItemId,
			url: info.pageUrl,
			srcUrl: info.srcUrl,
			title: tab.title
		};

		// Get access token
		VKFotki.getVKToken(function(token, userId, expires){

			// Get user albums from VK profile
			ReqManager.apiMethod("photos.getAlbums", {
				access_token: token
			}, function(data) {

				var albums = data.response;

				// Create long-live message passing from Background to Content script
				var port = chrome.tabs.connect(tab.id, {name: "vkLongConnect"});

				// Say to content script: Show popup
				port.postMessage({
					action: "showPopup",
					image: image,
					albums: albums
				});

				// And wait for response from content script
				port.onMessage.addListener(function(msg) {

					// Loading image
					var xhr = new XMLHttpRequest();
						xhr.open('GET', msg.image.srcUrl, true);
						xhr.responseType = 'blob';

					xhr.onload = function(e) {
						if (this.status == 200) {

							var blob = new Blob([this.response], {type: 'image/png'});

							var someImage = document.getElementById('someImage');
							if(someImage)
								someImage.parentNode.removeChild(someImage);

							var img = document.createElement('img');
							img.src = window.URL.createObjectURL(blob);
						    img.id = 'someImage';
						    img.setAttribute('data-size', blob.size);
						    document.body.appendChild(img);

							img.onload = function(e) {
								// Part 3, access the raw image data
							    var img = document.getElementById('someImage');
							    var canvas = document.createElement('canvas');
							    var ctx = canvas.getContext('2d');
							    canvas.width = img.width;
							    canvas.height = img.height;
							    ctx.drawImage(img, 0, 0);
							    document.body.appendChild(canvas);
							    var dataUrl = canvas.toDataURL('image/png', 0.5);

							    var binary = atob(dataUrl.split(',')[1]);
							    var array = [];
								for(var i = 0; i < binary.length; i++) {
								   array.push(binary.charCodeAt(i));
								}

								var file = new Blob([new Uint8Array(array)], {type: 'image/png'});
								console.log("Size of file: " + file.size);
								// End loading image

								// Upload photo to Album
								var formDataAlbum = new FormData();
								formDataAlbum.append('file1', file, 'Image.png');

								ReqManager.apiMethod("photos.getUploadServer", {
						    		access_token: token,
						    		aid: msg.post.album,
						    		// gid: userId,
						    		save_big: 0,
						    		uid: userId
						    	}, function(getUploadServer) {
						    		var album_upload_url = getUploadServer.response.upload_url;

								    // Part 4, upload image to VKontakte
								    var xhr = new XMLHttpRequest();
								    xhr.open('POST', album_upload_url, true);
								    xhr.onload = function(e) {

										var serverData = JSON.parse(this.response);

										ReqManager.apiMethod("photos.save", {
											access_token: token,
											aid: msg.post.album,
											server: serverData.server,
											photos_list: serverData.photos_list,
											hash: serverData.hash,
											caption: msg.post.comment
										}, function(result) {

											var uploaded_photo = result.response[0];

											/* POST WALL */
											if(msg.post.wall) {
												ReqManager.apiMethod("wall.post", {
													access_token: token,
													owner_id: userId,
													friends_only: 0,
													message: msg.post.comment,
													attachments: uploaded_photo.id
												}, function(result) {

													port.postMessage({
														action: 'finish',
														image_id: uploaded_photo.id
													})

													notify('Изображение загружено',"Ваше изображение добавлено на стенку");

												}, function(errCode) {
													console.log("ERROR: in method wall.post " + errCode);
													port.postMessage({
														action: 'error',
														error: "Не удалось отправить фото на стенку" + errCode
													})

													notify('Ошибка',"Не удалось отправить изображение на стенку");
												});

											} else {

												port.postMessage({
													action: 'finish',
													image_id: uploaded_photo.id
												})

												notify('Изображение загружено',"Ваше изображение добавлено в альбом");
											}

										}, function(errCode) {
											console.log("ERROR: in method photos.save " + errCode);
											port.postMessage({
												action: 'error',
												error: "Не удалось сохранить фото в альбом" + errCode
											})
											notify('Ошибка',"Не удалось сохранить изображение в альбом");
										});

								    };

								    xhr.send(formDataAlbum);

						    	}, function(errCode) {
						    		console.log('Error: in method photos.getUploadServer');
						    		port.postMessage({
										action: 'error',
										error: "Не удалось получить сервер для загрузки фотографии " + errCode
									})
									notify('Ошибка',"Не удалось получить сервер для загрузки изображения");
						    	});

							};

						} else {
							console.log('ERROR: Image return bad code ' + this.status);
							port.postMessage({
								action: 'error',
								error: "Не удалось загрузить изображение " + errCode
							})
							notify('Ошибка',"Не удалось загрузить изображение");
						};
					};

					xhr.send();

				});

			}, function(errCode) {
				console.log("ERROR: " + errCode);
				VKFotki.init(function(success){
					if(success){
						port.postMessage({
							action: 'error',
							error: "Не удалось получить альбомы пользователя " + errCode
						})
						notify('Ошибка',"Не удалось получить альбомы пользователя");
					}
				});

			});

		});

	},

	getVKToken: function(callback) {
		console.log('VKFotki: get auth token');

		// Check if data exists in localStorage
		if (localStorage['access_token'] && localStorage['user_id']) {
			// Check if token still active, get 10 seconds allowance
			if (localStorage['token_expires'] - 10000 > new Date().getTime()) {
				// Return data from localStorage
				return callback(
					localStorage['access_token'], 
					localStorage['user_id'], 
					localStorage['token_expires']
				);
			}
			else {
				// Clear localStorage
				localStorage.clear();
			}
		}

		var that = this;
		var loginTabId, loginWinId, intervalId;
		var url = "https://oauth.vk.com/authorize?" +
			"client_id=3551471&scope=photos,wall" +
			"&redirect_uri=http://oauth.vk.com/blank.html" +
			"&display=popup&response_type=token";

		// Create popup to grab token
		chrome.windows.create({
			url: url,
			left: 0,
			top: 0,
			width: 100,
			height: 100,
			focused: false,
			type: 'popup'
		}, function(win) {
			loginWinId = win.id;
			loginTabId = win.tabs[0].id;
		});

		chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
			if(loginTabId != tabId) {
				// Proccess only with VK login popup
				return;
			}

			// Searching for a token in url
			if(tab.url.indexOf('access_token')) {
				var tokenMatches = tab.url.match(/#access_token=(\w+).*expires_in=(\d+).*user_id=(\d+)/);
				if (tokenMatches) {
					var token = tokenMatches[1];
					var expires = tokenMatches[2];
					var userId = tokenMatches[3];

					var tokenExprires = new Date().getTime() + parseInt(expires, 10);

					localStorage['user_id'] = userId;
					localStorage['access_token'] = token;
					localStorage['token_expires'] = tokenExprires;

					chrome.tabs.remove(loginTabId);
					chrome.windows.remove(loginWinId);
					loginWinId = loginTabId = null;

					callback(token, userId, expires);
				}
			}
		});

	}
};

VKFotki.init();

/* Google Analytics */

var _gaq = _gaq || [];
_gaq.push(['_setAccount', 'UA-41131230-2']);
_gaq.push(['_trackPageview']);
setInterval(function(){
    _gaq.push(['_trackPageview','/active']);
},295000);

(function() {
  var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
  ga.src = 'https://ssl.google-analytics.com/ga.js';
  var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
})();