var ReqManager = {

	apiMethod: function(method, params, fnSuccess, fnFail) {
		var getParams = [];
		var performParams = {
			method: "POST",
			url: "https://api.vk.com/method/" + method
		}

		if (typeof params === "function") {
			fnFail = fnSuccess;
			fnSuccess = params;
			params = {};
		}

		if (params.access_token === undefined) {
			params.access_token = token // TODO: test token
		} else if (params.access_token === null) {
			delete params.access_token;
		}

		for (var prop in params)
			// getParams.push(encodeURIComponent(prop) + "=" + encodeURIComponent(params[prop]));
			getParams.push(encodeURIComponent(prop) + "=" + encodeURIComponent(params[prop]));

		if (getParams.length)
			performParams.url += "?" + getParams.join("&");

		performParams.data = params;
		return this._perform(performParams, fnSuccess, fnFail);
	},

	abort: function(xhrId) {
		if (this._xhrs[xhrId] === undefined) {
			throw new ReferenceError("No such request: " + xhrId);
		}

		this._xhrs[xhrId].abort();
		this._finalize(xhrId);
	},

	abortAll: function () {
		for (var xhrId in this._xhrs) {
			this._xhrs[xhrId].abort();
			this._finalize(xhrId);
		}
	},

	_perform: function(params, fnSuccess, fnFail) {
		var self = this,
			xhrId = params.url.replace(/[^a-z0-9]/g, "") + "_" + Math.random(),
			url = params.url,
			timeout = 25,
			formData;

		// убираем timeout из параметров
		if (params.timeout !== undefined) {
			timeout = params.timeout;
			delete params.timeout;
		}

		// устанавливаем обработчики
		this._callbacksOnSuccess[xhrId] = fnSuccess || null;
		this._callbacksOnFail[xhrId] = fnFail || null;

		// создаем XHR и добавляем ему уникальный идентификатор
		// responseType json : http://code.google.com/p/chromium/issues/detail?id=119256
		var xhr = new XMLHttpRequest();
		xhr.urid = xhrId;
		this._xhrs[xhrId] = xhr;

		// привязываем обработчики намертво
		if (this._boundCallbacks === null) {
			this._boundCallbacks = [this._onLoad.bind(this), this._onError.bind(this)];
		}

		xhr.open(params.method, url, true);
		xhr.addEventListener("load", this._boundCallbacks[0], false);
		xhr.addEventListener("error", this._boundCallbacks[1], false);
		xhr.addEventListener("abort", this._boundCallbacks[1], false);

		if (params.data) {
			formData = new FormData();
			for (var prop in params.data) {
				formData.append(prop, params.data[prop]);
			}

			xhr.send(formData);
		} else {
			xhr.send();
		}

		// таймаут запроса
		// http://code.google.com/p/chromium/issues/detail?id=119500
		this._timeoutIds[xhrId] = window.setTimeout(this._boundCallbacks[1], timeout * 1000, xhrId);
		return xhrId;
	},

	_onError: function(e) {
		var errorCode,
			xhrId;

		if (typeof e === "object") {
			xhrId = e.target.urid;
			errorCode = (e.type === "abort") ? this.ABORT : this.NO_INTERNET;
		} else {
			xhrId = e;
			errorCode = this.TIMEOUT;

			// сбрасываем подвисший запрос, чтобы он больше не висел в памяти
			this._xhrs[xhrId].removeEventListener("abort", this._boundCallbacks[1], false);
			this._xhrs[xhrId].abort();
		}

		if (errorCode === this.NO_INTERNET || errorCode === this.TIMEOUT) {
			// уведомление о работе сети
			// chrome.extension.sendMessage({"action" : "networkDown"});
			console.log('Network down');
		}

		if (typeof this._callbacksOnFail[xhrId] === "function") {
			this._callbacksOnFail[xhrId](errorCode);
		}

		this._finalize(xhrId);
	},

	_onLoad: function(e) {
		var res,
			xhr = e.target,
			xhrId = e.target.urid,
			errDataParams = {},
			errMethod = "";

		// уведомление о работе сети
		// chrome.extension.sendMessage({"action" : "networkUp"});
		console.log("network up")
		
		try {
			res = JSON.parse(xhr.responseText.replace(/[\x00-\x1f]/, ""));
		} catch (e) {
			// this._statSendFn("Custom-Errors", "Exception error", e.message);
			// LogManager.error("[" + xhrId + "] Not a JSON response: " + xhr.responseText + "");
			console.log('Not a JSON response' + xhr.responseText)

			if (typeof this._callbacksOnFail[xhrId] === "function") {
				this._callbacksOnFail[xhrId](this.NOT_JSON);
			}

			this._finalize(xhrId);
			return;
		}

		if (res.error !== undefined) {
			// вычленяем данные запроса
			res.error.request_params.forEach(function(paramData) {
				if (paramData.key === "access_token" || paramData.key === "oauth") {
					return;
				}

				if (paramData.key === "method") {
					errMethod = paramData.value;
				}

				errDataParams[paramData.key] = paramData.value;
			});

			// уведомляем в GA
			// this._statSendFn("Custom-Errors", "Request error", {
			// 	"method" : errMethod,
			// 	"code" : res.error.error_code
			// });

			switch (res.error.error_code) {
				case 5 :
					// LogManager.error("Access denied for request with params: " + JSON.stringify(errDataParams));
					// chrome.extension.sendMessage({"action" : "tokenStatus", "expired" : true});
					console.log("Access denied for request with params: " + JSON.stringify(errDataParams));

					if (typeof this._callbacksOnFail[xhrId] === "function") {
						this._callbacksOnFail[xhrId](this.ACCESS_DENIED);
					}

					break;

				case 14 :
					// LogManager.warn("XHR response has error code 14 (captcha). Params: " + JSON.stringify(errDataParams));
					// chrome.extension.sendMessage({"action" : "tokenStatus", "expired" : false});
					console.log("XHR response has error code 14 (captcha). Params: " + JSON.stringify(errDataParams));

					if (typeof this._callbacksOnFail[xhrId] === "function") {
						this._callbacksOnFail[xhrId](this.CAPTCHA, {
							"sid" : res.error.captcha_sid,
							"img" : res.error.captcha_img
						});
					}

					break;

				default :
					// LogManager.warn("XHR response has error field with code " + res.error.error_code + ". Params: " + JSON.stringify(errDataParams));
					// chrome.extension.sendMessage({"action" : "tokenStatus", "expired" : false});
					console.log("XHR response has error field with code " + res.error.error_code + ". Params: " + JSON.stringify(errDataParams));

					if (typeof this._callbacksOnFail[xhrId] === "function") {
						this._callbacksOnFail[xhrId](this.RESPONSE_ERROR, {
							"code" : res.error.error_code,
							"msg" : res.error.error_msg
						});
					}

					break;
			}
		} else {
			// chrome.extension.sendMessage({"action" : "tokenStatus", "expired" : false});

			if (typeof this._callbacksOnSuccess[xhrId] === "function") {
				this._callbacksOnSuccess[xhrId](res);
			}
		}

		this._finalize(xhrId);
	},

	_finalize: function(xhrId) {
		delete this._xhrs[xhrId];
		delete this._callbacksOnSuccess[xhrId];
		delete this._callbacksOnFail[xhrId];

		window.clearTimeout(this._timeoutIds[xhrId]);
		delete this._timeoutIds[xhrId];
	},

	_callbacksOnSuccess: {},
	_callbacksOnFail: {},
	_timeoutIds: {},
	_xhrs: {},
	_boundCallbacks: null,
	_statSendFn: null,

	NO_INTERNET: 1,
	NOT_JSON: 2,
	RESPONSE_ERROR: 3,
	TIMEOUT: 4,
	ABORT: 5,
	ACCESS_DENIED: 6,
	CAPTCHA: 7
}