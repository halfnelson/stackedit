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

	var PROVIDER_GITHUB = "github";
	  
	var merge = settings.conflictMode == 'merge';


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

	githubProvider.generateSyncIndex = function(attributes) {
		var result = [
			PROVIDER_GITHUB,
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
		githubHelper.read(importParameters.username, importParameters.repository, importParameters.branch, importParameters.path, function(err, username, content, sha) {
			if (err === undefined) {
				callback(content, sha);
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
			githubProvider.read(importParameters, function(content,sha) {
				fileDesc = fileMgr.createFile(githubProvider.generateTitleFromAttributes(importParameters), content);
				importParameters.provider = githubProvider;
				importParameters.format = "markdown";
				importParameters.sha = sha;
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

	/*
	 * Synchronizer Support 
	 */

	githubProvider.importFiles = function() {
 		var $selected = $(document.querySelector("#input-sync-import-selected"));
 		var path = $selected.attr("data-document-path");
		var repo = $selected.attr("data-document-repo");
		var branch = $selected.attr("data-document-branch" );
		var parsedRepository = repo.match(/[\/:]?([^\/:]+)\/([^\/]+?)(?:\.git)?$/);
		if(parsedRepository) {
			repo = parsedRepository[2];
			username = parsedRepository[1];
		} else {
			return;
		}

		if(!username || !repo || !branch || !path) {
			return;
		}
		
		var syncAttributes = {
			username: username,
			repository: repo,
			branch: branch,
			path: path,
			provider: githubProvider,
			sha: false
		}

		var syncIndex = githubProvider.generateSyncIndex(syncAttributes);
		syncAttributes.syncIndex = syncIndex;
		var syncLocations = {};
		syncLocations[syncAttributes.syncIndex] = syncAttributes;

		var fileDesc = fileMgr.getFileFromSyncIndex(syncIndex);
		if(fileDesc !== undefined) {
			return eventMgr.onError('"' + fileDesc.title + '" is already in your local documents.');
		}
	
		githubProvider.read(syncAttributes, function(content, sha) {
			syncAttributes.sha = sha;
			var title = githubProvider.generateTitleFromAttributes(syncAttributes);
			syncAttributes.contentCRC = utils.crc32(content);
			syncAttributes.titleCRC = utils.crc32(title);

			if(merge === true) {
				// Need to store the whole content for merge
				syncAttributes.content = content;
				syncAttributes.title = title;
				syncAttributes.discussionList = '{}';
			}

			fileDesc = fileMgr.createFile(title, content, null, syncLocations);
			fileMgr.selectFile(fileDesc);
			eventMgr.onSyncImportSuccess([fileDesc], githubProvider);
		});
		
        
    };

    githubProvider.exportFile = function(event, title, content, discussionListJSON, frontMatter, callback) {
		var repo = utils.getInputTextValue("#input-sync-export-github-repo", event);
		var branch = utils.getInputTextValue("#input-sync-export-github-branch", event);
		var filename = utils.getInputTextValue("#input-sync-export-github-filename", event);
		var folder = utils.getInputTextValue("#input-sync-export-github-path", event);

		if (!branch || !filename || !repo ) {
			return callback(true);
		}

		var parsedRepository = repo.match(/[\/:]?([^\/:]+)\/([^\/]+?)(?:\.git)?$/);
		if(parsedRepository) {
			repo = parsedRepository[2];
			username = parsedRepository[1];
		} else {
			return callback(true);
		}
		
		var path = folder ? (folder + "/" + filename) : filename;

        	
		var syncAttributes = {
			username: username,
			repository: repo,
			branch: branch,
			path: path,
			provider: githubProvider,
			sha: false
		}
		
		// Check that file is not synchronized with another one
		var syncIndex = githubProvider.generateSyncIndex(syncAttributes);
        var fileDesc = fileMgr.getFileFromSyncIndex(syncIndex);
        if(fileDesc !== undefined) {
            var existingTitle = fileDesc.title;
            eventMgr.onError('File path is already synchronized with "' + existingTitle + '".');
            return callback(true);
		}

		var commitMsg = settings.commitMsg;

		githubHelper.upload(syncAttributes.repository, syncAttributes.username, syncAttributes.branch, syncAttributes.path, content, commitMsg, function(err, username, sha) {
			if (err) {
				return callback(err, true);
			}
			syncAttributes.sha = sha;
			syncAttributes.contentCRC = utils.crc32(content);
			syncAttributes.titleCRC = utils.crc32(title);
			syncAttributes.discussionListCRC = utils.crc32(discussionListJSON);
			syncAttributes.syncIndex = syncIndex
			if(merge === true) {
				// Need to store the whole content for merge
				syncAttributes.content = content;
				syncAttributes.title = title;
				syncAttributes.discussionList = discussionListJSON;
			}
			callback(undefined, syncAttributes);
		});
    };

    githubProvider.syncUp = function(content, contentCRC, title, titleCRC, discussionList, discussionListCRC, frontMatter, syncAttributes, callback) {
        if(syncAttributes.contentCRC == contentCRC) {
            return callback(undefined, false);
        }
	    
		var commitMsg = settings.commitMsg;
		console.log("syncing up",title);
		githubHelper.upload(syncAttributes.repository, syncAttributes.username, syncAttributes.branch, syncAttributes.path, content, commitMsg, function(err, username, sha) {
			if (err) {
				return callback(err, true);
			}
			syncAttributes.sha = sha;
			syncAttributes.contentCRC = contentCRC;
			syncAttributes.titleCRC = titleCRC; // Not synchronized but has to be there for syncMerge
            syncAttributes.discussionListCRC = discussionListCRC;
			callback(undefined, true);
		});
    };

    githubProvider.syncDown = function(callback) {
		var downloadFileList = [];

		function fileDown() {
			if(downloadFileList.length === 0) {
				return callback();
			}
			var fileDesc = downloadFileList.pop();
			var allSyncAttribute = _.values(fileDesc.syncLocations);
			var syncAttributes = _(allSyncAttribute).find(function(a) { return a.provider.providerId == githubProvider.providerId });

			if (syncAttributes) {
				console.log("syncing down",fileDesc.title);
				githubProvider.read(syncAttributes, function(content, sha) {
					//shim things we dont sync
					var remoteTitle = fileDesc.title;
					var remoteDiscussionList = fileDesc.discussionList;
					var remoteDiscussionListJSON = fileDesc.discussionListJSON;

					var remoteCRC = githubProvider.syncMerge(fileDesc, syncAttributes, content, remoteTitle, remoteDiscussionList, remoteDiscussionListJSON);
					
					// Update syncAttributes
					syncAttributes.sha = sha;
					if(merge === true) {
						// Need to store the whole content for merge
						syncAttributes.content = content;
						syncAttributes.title = remoteTitle;
						syncAttributes.discussionList = remoteDiscussionListJSON;
					}
					syncAttributes.contentCRC = remoteCRC.contentCRC;
					syncAttributes.titleCRC = remoteCRC.titleCRC;
					syncAttributes.discussionListCRC = remoteCRC.discussionListCRC;
					utils.storeAttributes(syncAttributes);
					setTimeout(fileDown, 5);
				});
			} else {
				setTimeout(fileDown, 5);
			}
		}

		downloadFileList = _.values(fileSystem);
		fileDown();
	};


	function createRepoBrowser(modalElt, onFileClick) {
		var documentEltTmpl = [
			'<a href="#" class="list-group-item document clearfix" data-document-sha="<%= document.sha %>" data-document-path="<%= document.path %>" data-document-type="<%= document.type %>">',
			'<div class="name"><i class="<%= document.type == "blob" ? "icon-file" : "icon-folder" %>"></i> ',
			'<%= document.path %></div>',
			'</a>'
		].join('');

		
		
		var $documentListElt = $(modalElt.querySelector('.document-list'));
		var $repoSelect = $(modalElt.querySelector('.input-github-repo-selector'));
		var $branchSelect = $(modalElt.querySelector('.input-github-branch-selector'));
		var $pleaseWait = $(modalElt.querySelector(".please-wait"));
		var $currentFolder = $(modalElt.querySelector(".current-folder"));
		var $upButton = $(modalElt.querySelector(".action-github-folder-up"));
		var $currentPathInput = $(modalElt.querySelector(".input-github-path"));
		
		var selectedRepo = function() {
			return $repoSelect.val();
		}

		var selectedBranch = function() {
			return $branchSelect.val();
		}

		var currentPathSegments = [];

		var currentPath = function() {
			if (currentPathSegments.length == 0) return { path: '/', tree: selectedBranch() };
			return currentPathSegments[currentPathSegments.length-1];
		}

		var currentPathFolder = function() {
			return _(currentPathSegments).map(function(s) { return s.path; }).join("/");
		}
		
		var currentPathTree = function() {
			return currentPath().tree;
		}

		var resetPath = function() {
			currentPathSegments = [];
			updateCurrentFolder();
		}

		var popPath = function() {
			currentPathSegments.pop();
			updateCurrentFolder();
			updateFileList();
		}

		var pushPath = function(folder, sha) {
			currentPathSegments.push({ path: folder, tree: sha });
			updateCurrentFolder();
			updateFileList();
		}

		var updateCurrentFolder = function() {
			$currentPathInput.val(currentPathFolder());
			$currentFolder.text("/"+currentPathFolder());
		}

		var showWait = function() {
			$documentListElt.empty();
			$pleaseWait.show();
		}

		var hideWait = function() {
			$pleaseWait.hide();
		}

		var updateRepoList = _.debounce(function() {
			showWait();
			githubHelper.getRepos(function(err, repos) {
				if (err) {
					throw err;
				}
				$repoSelect.children('option').remove();
				var sortedRepos = _(repos).sortBy(function(i) { return i.full_name.toLowerCase() });
				_(sortedRepos).each(function(r) {
					$repoSelect.append($("<option></option>").attr('value',r.full_name).text(r.full_name));
				})
				updateBranchList();
			})
		}, 10, true);

		var updateBranchList = _.debounce(function(){
			showWait();
			var repo = selectedRepo();
			$branchSelect.children('option').remove();
			if (!repo) {
				$branchSelect.prop("disabled",true);
				return;
			}
			$branchSelect.prop("disabled",false);
			
			githubHelper.getBranchesForRepo(repo, function(err, branches) {
				if (err) {
					throw err;
				}
				console.log("gor branches", branches);
				var sortedBranches = _(branches).sortBy(function(i) { return i.toLowerCase() });
				var hasMaster = false;
				_(sortedBranches).each(function(r) {
					if (r == "master") { hasMaster = true; }
					$branchSelect.append($("<option></option>").attr('value',r).text(r));
				})
				if (hasMaster) {
					$branchSelect.val("master");
				}
				resetPath();
				updateFileList();
			})
		}, 10, true);

		var updateFileList = _.debounce(function(){
			showWait();
			var repo = selectedRepo();
			var branch = selectedBranch();
			var pathSha = currentPathTree();
			console.log("loading",repo,branch,pathSha)
			githubHelper.getFilesForTree(repo, pathSha, function(err, files) {

				var sortedFiles = _(files).sortBy(function(f) {  return f.type == "blob" ? "Z"+f.path : "A"+f.path });        

				var documentListHtml = _.reduce(sortedFiles, function(result, document) {
					
					return result + _.template(documentEltTmpl, {
						document: document,
					});
				}, '');
				hideWait();
				$documentListElt.html(documentListHtml);

			});
		}, 10, true);

		$upButton.on("click", popPath );
		$repoSelect.on("change", updateBranchList);
		$branchSelect.on("change", updateFileList);
		$documentListElt.on("click", ".document", function(e) {
			var el = e.currentTarget;
			var type = $(el).attr("data-document-type");
			var path = $(el).attr("data-document-path");
			var sha = $(el).attr("data-document-sha");
			console.log("clicked",type, path)
			if (type == "tree") {
				pushPath(path, sha);
			}
			if (type == "blob") {
				onFileClick(selectedRepo(), selectedBranch(), currentPathFolder()+"/"+path )
			}
			console.log("clicked",el);
		})
		$(modalElt)
			.on('show.bs.modal', function() {
				updateRepoList();
			});


	}



	eventMgr.addListener("onReady", function() {

		//import dialog
		var modalElt = document.querySelector('.modal-download-github');
		
		var $openButton = $(modalElt.querySelector(".action-sync-import-github"));
		var $selected = $(modalElt.querySelector("#input-sync-import-selected"));

		function onFileSelected(repo, branch, path) {
			$selected.attr("data-document-path", path );
			$selected.attr("data-document-repo", repo );
			$selected.attr("data-document-branch", branch );
			$openButton.trigger("click");
		}

		createRepoBrowser(modalElt, onFileSelected);


		//export dialog
		var modalElt = document.querySelector('.modal-upload-github');
		createRepoBrowser(modalElt);
		

	



	});


	return githubProvider;
});