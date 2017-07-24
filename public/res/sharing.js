define([
	"jquery",
	"underscore",
	"constants",
	"utils",
	"eventMgr",
	"fileMgr",
	"classes/AsyncTask",
	"classes/Provider",
	"providers/couchdbProvider",
	"providers/downloadProvider",
	"providers/gistProvider",
	"providers/githubProvider"
], function($, _, constants, utils, eventMgr, fileMgr, AsyncTask, Provider) {

	var sharing = {};

	// Create a map with providerId: providerModule
	var providerMap = _.chain(arguments).map(function(argument) {
		return argument instanceof Provider && [
			argument.providerId,
			argument
		];
	}).compact().object().value();

	// Listen to offline status changes
	var isOffline = false;
	eventMgr.addListener("onOfflineChanged", function(isOfflineParam) {
		isOffline = isOfflineParam;
	});

	sharing.getEditorParams = function(attributes) {
		var provider = attributes.provider;
		var params = {
			provider: provider.providerId
		};
		if(!provider.editorSharingAttributes) {
			return;
		}
		_.each(provider.editorSharingAttributes, function(attributeName) {
			params[attributeName] = attributes[attributeName];
		});
		return params;
	};

	sharing.getViewerParams = function(attributes) {
		var provider = attributes.provider;
		// If document is not published in markdown format
		if(attributes.format != "markdown") {
			return;
		}
		var params = {
			provider: provider.providerId
		};
		if(!provider.viewerSharingAttributes) {
			return;
		}
		_.each(provider.viewerSharingAttributes, function(attributeName) {
			params[attributeName] = attributes[attributeName];
		});
		return params;
	};

	function removeURLParameter(url, parameter) {
		//prefer to use l.search if you have a location/link object
		var urlparts= url.split('?');   
		if (urlparts.length>=2) {

			var prefix= encodeURIComponent(parameter)+'=';
			var pars= urlparts[1].split(/[&;]/g);

			//reverse iteration as may be destructive
			for (var i= pars.length; i-- > 0;) {    
				//idiom for string.startsWith
				if (pars[i].lastIndexOf(prefix, 0) !== -1) {  
					pars.splice(i, 1);
				}
			}

			url= urlparts[0] + (pars.length > 0 ? '?' + pars.join('&') : "");
			return url;
		} else {
			return url;
		}
	}


	eventMgr.addListener("onReady", function() {
		// Check parameters to see if we have to download a shared document
		var importParameters, provider, providerId = utils.getURLParameter("provider");
		var newLocation = window.location.href;

		if(window.viewerMode) {
			if(providerId === undefined) {
				providerId = "download";
			}
			provider = providerMap[providerId];
			if(provider === undefined) {
				return;
			}
			importParameters = {};
			if(_.some(provider.viewerSharingAttributes, function(attributeName) {
				var parameter = utils.getURLParameter(attributeName);
				if(!parameter) {
					return 1;
				}
				importParameters[attributeName] = parameter;
				newLocation = removeURLParameter(newLocation, attributeName );
			})) {
				return;
			}
			newLocation = removeURLParameter(newLocation, "provider" );
			history.replaceState(null,window.title,newLocation);
			provider.importPublic(importParameters, utils.lockUI(function(error, title, content) {
				if(error) {
					return;
				}
				var fileDesc = fileMgr.createFile(title, content, undefined, undefined, true);
				fileMgr.selectFile(fileDesc);
			}));
		}
		else if(providerId) {
			provider = providerMap[providerId];
			if(provider === undefined) {
				return;
			}
			importParameters = {};
			if(_.some(provider.editorSharingAttributes, function(attributeName) {
				var parameter = utils.getURLParameter(attributeName);
				if(!parameter) {
					return 1;
				}
				importParameters[attributeName] = parameter;
				newLocation = removeURLParameter(newLocation, attributeName );
			})) {
				return;
			}
			newLocation = removeURLParameter(newLocation, "provider" );
			history.replaceState(null,window.title,newLocation);
			provider.importPrivate(importParameters, utils.lockUI());
		}
	});

	eventMgr.onSharingCreated(sharing);
	return sharing;
});
