define([
	"underscore",
	"utils",
	"classes/Provider",
	"settings",
	"eventMgr",
 	"fileSystem",
	 "fileMgr",
	 "storage",
	"helpers/githubHelper"
], function(_, utils, Provider, settings, eventMgr, fileSystem, fileMgr, storage, githubHelper) {


  


	var githubProvider = new Provider("github", "GitHub");
	githubProvider.publishPreferencesInputIds = [
		"github-repo",
		"github-branch"
	];

	

	githubProvider.editorSharingAttributes = [
		"username",
        "repository",
		"branch",
		"path"
    ];


	githubProvider.generateTitleFromAttributes = function(attributes) {
		var result = [
			attributes.username,
			attributes.repository,
			attributes.branch,
			attributes.path
		];
		return result.join('/');
	};

	githubProvider.samePublishLocation = function(attr1, attr2) {
		return attr1.username == attr2.username &&
			   attr1.repository == attr2.repository &&
			   attr1.branch == attr2.branch &&
			   attr1.path == attr2.path;
	};


	githubProvider.getPublishLocationLink = function(attributes) {
		var result = [
			'https://github.com',
			attributes.username,
			attributes.repository,
			'blob',
			attributes.branch
		];
		return result.concat(attributes.path.split('/').map(encodeURIComponent)).join('/');
	};

	githubProvider.publish = function(publishAttributes, frontMatter, title, content, callback) {
		var commitMsg = settings.commitMsg;
		githubHelper.upload(publishAttributes.repository, publishAttributes.username, publishAttributes.branch, publishAttributes.path, content, commitMsg, function(err, username) {
			publishAttributes.username = username;
			callback(err);
		});
	};

	githubProvider.read = function(importParameters, callback) {
		githubHelper.read(importParameters.username, importParameters.repository, importParameters.branch, importParameters.path, function(err, username, content) {
			if (err === undefined) {
				callback(content);
 			} else {
 				callback("");
 			}
 		});
	}



	githubProvider.importPrivate = function(importParameters, callback) {
		var fileDesc = null;

		//lets never overwrite an existing file with this method. We can provide a way to clobber and reimport
		utils.retrieveIndexArray("file.list").forEach(function(fileIndex) {
			var existingPublishIndex = _(fileSystem[fileIndex].publishLocations).find(function(filePublishAttributes) {
				return githubProvider.samePublishLocation(importParameters, filePublishAttributes)
			})

			if (existingPublishIndex) {
				fileDesc = fileSystem[fileIndex];
			}
		});

		if (fileDesc != null) {
			function overwrite() {
				githubProvider.read(importParameters, function(content) {
					eventMgr.onContentChanged(fileDesc, content);
					fileMgr.selectFile(fileDesc);
					callback();
				});
			}
			function keep() {
				fileMgr.selectFile(fileDesc);
				callback();
			}
			utils.overwriteConfirm(overwrite, keep);

		} else {
			
			githubProvider.read(importParameters, function(content) {
				fileDesc = fileMgr.createFile(githubProvider.generateTitleFromAttributes(importParameters), content);
				importParameters.provider = githubProvider;
				importParameters.format = "markdown";
				var publishIndex;
				do {
					publishIndex = "publish." + utils.id();
				} while(_.has(storage, publishIndex));
				importParameters.publishIndex = publishIndex;
				fileDesc.addPublishLocation(importParameters);
				eventMgr.onContentChanged(fileDesc, content);
				fileMgr.selectFile(fileDesc);
				callback();
			});
		}
	};


	githubProvider.newPublishAttributes = function(event) {
		var publishAttributes = {};
		publishAttributes.repository = utils.getInputTextValue("#input-publish-github-repo", event);
		publishAttributes.branch = utils.getInputTextValue("#input-publish-github-branch", event);
		publishAttributes.path = utils.getInputTextValue("#input-publish-file-path", event);
		if(event.isPropagationStopped()) {
			return undefined;
		}
		var parsedRepository = publishAttributes.repository.match(/[\/:]?([^\/:]+)\/([^\/]+?)(?:\.git)?$/);
		if(parsedRepository) {
			publishAttributes.repository = parsedRepository[2];
			publishAttributes.username = parsedRepository[1];
		}
		return publishAttributes;
	};

	return githubProvider;
});