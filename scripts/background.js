function notify(title, message) {
	var notificationId = 'VKFotkiNotification';
	var iconUrl = chrome.extension.getURL('img/colors.png');

	// Remove all old notifications
	chrome.notifications.getAll(function(data) {
		if (data.hasOwnProperty(notificationId)) {
			chrome.notifications.clear(notificationId);
		}
	})

	// Create a new notification
	chrome.notifications.create(notificationId, {
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

		// Get token, get albums from VK and start message passing with content script.
		VKFotki.getVKToken()
			.then(VKFotki.getVKAlbumbs)
			.then(function(albums) {
				return VKFotki.startMessagePassing(image, albums, tab)
			})
			.finally(function(albums) {
				console.log('Conext menu click handled');
			})
			.catch(function(err) {
				console.error(err);
				notify('Ошибка', err.message);
	    });
	},

	onReceiveMessage: function(msg) {
		console.log('VKFotki: received message from content script');

		// TODO: add validate to verify image

		// Loading and convert image, all magic here
		var xhr = new XMLHttpRequest();
			xhr.open('GET', msg.image.srcUrl, true);
			xhr.responseType = 'blob';

		xhr.onload = function(e) {
			if (this.status == 200) {

				var blob = new Blob([this.response], {type: 'image/png'});

				// console.log(window.URL.createObjectURL(blob));
				var uploadedImage = document.getElementById('uploadedImage');
				if(uploadedImage)
					uploadedImage.parentNode.removeChild(uploadedImage);

				var img = document.createElement('img');
				img.src = window.URL.createObjectURL(blob);
		    img.id = 'uploadedImage';
		    img.setAttribute('data-size', blob.size);
		    document.body.appendChild(img);

				img.onload = function(e) {
					// Part 3, access the raw image data
			    var img = document.getElementById('uploadedImage');
			    var canvas = document.createElement('canvas');
			    var ctx = canvas.getContext('2d');
			    canvas.width = img.width;
			    canvas.height = img.height;
			    ctx.drawImage(img, 0, 0);
			    document.body.appendChild(canvas);
			    var dataUrl = canvas.toDataURL('image/png', 0.7);

			    var binary = atob(dataUrl.split(',')[1]);
			    var array = [];
					for(var i = 0; i < binary.length; i++) {
					  array.push(binary.charCodeAt(i));
					}

					var file = new Blob([new Uint8Array(array)], {type: 'image/png'});
					console.log("Image converted, size of the image: " + file.size + ' bytes');
					// End loading image

					// Upload photo to Album
					var formDataAlbum = new FormData();
					formDataAlbum.append('file1', file, 'Image.png');

					VKFotki.getUploadServerAndUploadPhoto(msg, formDataAlbum)
						.then(function(serverData) {
							return VKFotki.saveImage(msg, serverData);
						})
						.then(function(uploadedPhoto) {
							if (msg.post.wall) {
								return VKFotki.postToWall(msg, uploadedPhoto)
							} 
							else {
								return new Promise.resolve();
							}
						})
						.finally(function() {
							console.log('VKFotki: Image succesffuly uploaded to VKontakte');

							console.log(msg.post);

							if (msg.post.wall) {
								notify('Изображение загружено', 'Изображение успешно добавлено в альбом и опубликовано на стене');
							}
							else {
								notify('Изображение загружено', 'Изображение успешно добавлено в альбом');
							}
						})
						.catch(function(err) {
							console.error(err);
							notify('Ошибка', err.message);
				    });

				};

			} else {
				console.error('ERROR: XHR onload method return ' + this.status);
				notify('Ошибка', 'Не удалось загрузить изображение');
			};
		};

		xhr.send();
	},

	getUploadServerAndUploadPhoto: function(msg, formDataAlbum) {
		console.log('VKFotki: getting an upload server');

		return new Promise(function(resolve, reject) {
			ReqManager.apiMethod("photos.getUploadServer", {
    		access_token: localStorage['access_token'], 
    		aid: msg.post.album,
    		// gid: userId,
    		save_big: 0,
    		uid: localStorage['user_id']
    	}, function(data) {
    		var uploadUrl = data.response.upload_url;

		    // Part 4, upload image to VKontakte
		    var xhr = new XMLHttpRequest();
		    xhr.open('POST', uploadUrl, true);
		    xhr.onload = function(e) {
		    	if (this.status == 200) {
						var serverData = JSON.parse(this.response);
						return resolve(serverData);
					}
					else {
						var error = {
							code: this.status,
							message: 'Не загрузить фотографию на сервер ВКонтакте'
						}
						return reject(error);
					}
				}

				xhr.send(formDataAlbum);

    	}, function(errCode) {
    		var error = {
					code: errCode,
					message: 'Не удалось получить сервер для загрузки фотографии'
				}
				return reject(error);
    	});
		});
	},

	saveImage: function(msg, serverData) {
		console.log('VKFotki: saving an image')

		return new Promise(function(resolve, reject) {
			ReqManager.apiMethod("photos.save", {
				access_token: localStorage['access_token'],
				aid: msg.post.album,
				server: serverData.server,
				photos_list: serverData.photos_list,
				hash: serverData.hash,
				caption: msg.post.comment
			}, function(result) {
				// Continue if photo succesffully saved
				var uploaded_photo = result.response[0];
				return resolve(uploaded_photo);
			}, function(errCode) {
				var error = {
					code: errCode,
					message: 'Не удалось сохранить изображение в альбом'
				}
				return reject(error);
			});
		});
	},

	postToWall: function(msg, uploaded_photo) {
		console.log('VKFotki: posting to wall')

		return new Promise(function(resolve, reject) {
			ReqManager.apiMethod("wall.post", {
				access_token: localStorage['access_token'],
				owner_id: localStorage['user_id'],
				friends_only: 0,
				message: msg.post.comment,
				attachments: uploaded_photo.id
			}, function(result) {
				return resolve(result);
			}, function(errCode) {
				var error = {
					code: errCode,
					message: 'Не удалось опубликовать изображение на стене'
				}
				return reject(error);
			});
		});
	},

	startMessagePassing: function(image, albums, tab) {
		console.log('VKFotki: start message passing')

		return new Promise(function(resolve, reject) {
			// Create long-live message passing from Background to Content script
			var port = chrome.tabs.connect(tab.id, {name: "vkLongConnect"});

			// Say to content script: Show popup
			port.postMessage({
				action: "showPopup",
				image: image,
				albums: albums
			});

			// And wait for response from content script
			port.onMessage.addListener(VKFotki.onReceiveMessage);

			resolve();
		});
	},

	getVKAlbumbs: function(token, userId, tokenExprires) {
		console.log('VKFotki: get user albums')

		return new Promise(function(resolve, reject) {
			// Get user albums from VK profile
			ReqManager.apiMethod("photos.getAlbums", {
				access_token: token
			}, function(data) {
				var albums = data.response;
				resolve(albums);
			}, function(errCode) {
				var error = {
					code: errCode,
					message: 'Не удалось получить альбомы пользователя'
				}
				return reject(error);
			});
		});
	},

	getVKToken: function() {
		console.log('VKFotki: get auth token');

		return new Promise(function(resolve, reject) {
			// Check if data exists in localStorage
			if (localStorage['access_token'] && localStorage['user_id']) {
				// Check if token still active, get 10 seconds allowance
				if (localStorage['token_expires'] - 10000 > new Date().getTime()) {
					// Return data from localStorage
					return resolve(
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

						return resolve(token, userId, expires);
					}
				}
			});
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