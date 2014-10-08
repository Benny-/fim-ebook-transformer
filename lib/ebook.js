var cheerio         = require('cheerio');
var request         = require('request');
var fs              = require('fs');
var fsp             = require('fs-promise');
var Q               = require('q');
var glob            = require("glob");
var child_process   = require('child_process');
var path            = require('path')

module.exports.extract = function(filename, storyDirectoryDestination) {
    var deferred = Q.defer();
    
    var child = child_process.spawn('unzip', [filename,'-d',storyDirectoryDestination] );
    child.stdin.end();
    
    child.stdout.on('data', function(block)
    {
        // Throw it away to make sure child process does not block on output write.
    });
    
    child.stderr.on('data', function(block)
    {
        // Throw it away to make sure child process does not block on output write.
    });
    
    child.on('close', function (code) {
        if (code !== 0)
            deferred.reject(new Error('unzip' + " returned error code " + code));
        else
            deferred.resolve(storyDirectoryDestination);
    });
    
    return deferred.promise;
};

module.exports.tidy = function(storyDirectory) {
    // console.log("module.exports.tidy()", storyDirectory)
    
    var deferred = Q.defer();
    
    var tidy_options_args = ['-utf8', '-quiet', '-modify'];
    
    glob( path.join(storyDirectory, '*.html'), function(err, files) {
        if(err)
            deferred.reject(new Error(err));
        else
        {
            var child = child_process.spawn('tidy', tidy_options_args.concat(files) );
            child.stdin.end();
            
            child.stdout.on('data', function(block)
            {
                // Throw it away to make sure child process does not block on output write.
            });
            
            child.stderr.on('data', function(block)
            {
                // Throw it away to make sure child process does not block on output write.
            });
            
            child.on('close', function (code) {
                // tidy error codes:
                // 0: no errors or warnings
                // 1: a warning occured
                // 2: a error occured
                if (code !== 0 && code !== 1)
                    deferred.reject(new Error('tidy' + " returned error code " + code));
                else
                    deferred.resolve(storyDirectory);
            });
        }
    });
    
    return deferred.promise;
};

var guessExtension = function(url) {
    if(url.match(/.gif/i))
        return 'gif';
    
    if(url.match(/.jpg/i))
        return 'jpeg';
    
    if(url.match(/.jpeg/i))
        return 'jpeg';
    
    if(url.match(/.png/i))
        return 'png';
    
    return 'png'; // XXX: We simply return png and hope the client will figure out the correct image type.
}

var imageCounter = 0;
var embedImages_single_file = function(htmlFile, imageDir, imageDirName) {
    // console.log("embedImages_single_file()", htmlFile )
    
    return fsp.readFile(htmlFile)
    .then(function(data) {
        var $ = cheerio.load(data);
        var imageTags = $('img');
        var promises = [];
        for(var i = 0; i<imageTags.length; i++)
        {
            // This inmediatly executing closure is required so multiple different request-closures don't share the same variables.
            (function() {
                var deferred = Q.defer();
                var imageTag = imageTags[i];
                var imageUrl = imageTag.attribs.src;
                var newImageId = imageCounter++;
                
                var destStream = fs.createWriteStream( path.join(imageDir, String(newImageId) + '.' + guessExtension(imageUrl)) );
                var readStream = request.get(imageUrl);
                readStream.pipe(destStream);
                
                destStream.once('close', function() {
                    imageTag.attribs.src = imageDirName+'/'+newImageId+'.'+guessExtension(imageUrl);
                    deferred.resolve(imageTag.attribs.src);
                });
                
                readStream.once('error', function(err) {
                    destStream.end(); // Not sure if destStream will close on error. Meh, we close it anyway here.
                    deferred.reject(new Error(err));
                });
                
                promises.push(deferred.promise);
            }) ();
        }
        
        return Q.all(promises)
                .then( function() { return fsp.writeFile(htmlFile, $.html()) } );
    });
}

module.exports.embedImages = function(storyDirectory) {
    // console.log("module.exports.embedImages()", storyDirectory)
    
    var imageDirName = 'images';
    var imageDir = path.join(storyDirectory, 'images');
    
    return fsp.mkdir( imageDir )
        .then(function(){
            
            var deferred = Q.defer();
            glob( path.join(storyDirectory, '*.html'), function(err, files) {
                if(err)
                    deferred.reject(new Error(err));
                else
                    deferred.resolve(files);
            })
            
            return deferred.promise
                    .then( function(files) {
                        var embedImages_single_file_promises = [];
                        files.forEach(function(file) {
                            embedImages_single_file_promises.push(embedImages_single_file(file, imageDir, imageDirName))
                        });
                        return Q.all(embedImages_single_file_promises);
                    });
        })
};

var runProgram = function(programName, args, options) {
    // console.log('runProgram()', programName, args, options)
    
    var deferred = Q.defer();
    
    var child = child_process.spawn(programName, args, options );
    child.stdin.end();
    
    child.stdout.on('data', function(block)
    {
        // console.log(String(block))
        // Throw it away to make sure child process does not block on output write.
    });
    
    child.stderr.on('data', function(block)
    {
        // console.log(String(block))
        // Throw it away to make sure child process does not block on output write.
    });
    
    child.on('close', function (code) {
        if (code !== 0)
            deferred.reject(new Error(programName + " returned error code " + code));
        else
            deferred.resolve();
    });
    
    return deferred.promise;
}

module.exports.pack = function(storyDirectory, filenameDestination) {
    // console.log('module.exports.pack()', storyDirectory, filenameDestination)
    
    return runProgram('zip', ['-X', filenameDestination, 'mimetype'], { cwd:storyDirectory } )
            .then( function() { return runProgram('zip', ['-Xrg', filenameDestination, 'META-INF'], { cwd:storyDirectory } ) } )
            .then( function() { return runProgram('zip', ['-Xrg', filenameDestination, './'], { cwd:storyDirectory } ) } )
};

module.exports.convert = function(filename, filenameDestination, options) {
    return runProgram('ebook-convert', [filename, filenameDestination].concat(options) ); // options go last for ebook-convert
};

