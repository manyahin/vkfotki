$(document).ready(function() {
	console.log('Content script start');
})

var popup = null;

chrome.runtime.onConnect.addListener(function(port) {
	// Start receive messages from Background;
	port.onMessage.addListener(function(msg) {
		console.log(msg);
		switch(msg.action) {
			case "show": // Show popup with info
				console.log('Receive message, show popup!');

				// Create magnific popup
				if(popup !== null) {
					$(popup).html('');
				} else {
					popup = $('<div>', {
			    		id: "vkfotki_popup",
			    		class: "white-popup mfp-hide"
			    	}).appendTo('body');
				}

				// Mustahce
		    	var req = new XMLHttpRequest();
				req.open("GET", chrome.extension.getURL('tpl/postForm.html'), true);
				req.onreadystatechange = function() {
				    if (req.readyState == 4 && req.status == 200) {

				        var tb = Mustache.to_html(
				            req.responseText,
				            {
				                "srcUrl": msg.image.srcUrl,
				                "description": msg.image.title,
				                "albums": msg.albums,
				                "srcLoadingImage": chrome.extension.getURL('img/ajax-loader.gif'),
				                "srcLinkIcon": chrome.extension.getURL('img/icon_share.png')
				            }
				        );

				        $(popup).append(tb);

				        $.magnificPopup.open({
			        		items: {
				 				type: "inline",
				 				src: "#vkfotki_popup",			
				 			},
				 			removalDelay: 300,
				 			mainClass: 'mfp-fade',
				        	callbacks: {
							    open: function() {

							      var dom = $($(this)[0].content[0]);
							      var self = this

							      dom.find('.cancel').click(function(){
							      	self.close();
							      })

							      dom.find('.send').click(function(){

							      	// Create request for background
							      	var post = {
							      		album: dom.find('#albums').val(),
							      		comment: dom.find('#comment').val(),
							      		wall: dom.find('#wallOption').attr('checked') ? true : false
							      	}

								    port.postMessage({
								    	action: "upload",
								    	post: post,
								    	image: msg.image,
								    	albums: msg.albums
								    });

								    self.close();

							      })

							    }
							}
				        });

				    }
				};
				req.send(null);

				break;

			case "finish":
				console.log('I have receive message, what uploading photo are finish');
				break;
			case "error":
				console.log('I receive Error, ' + msg.error);
				break;

		} // End switch
	});

});