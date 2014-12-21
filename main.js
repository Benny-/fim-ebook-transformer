#!/usr/bin/env node

var normalize_newline  = require('normalize-newline')
var bboxed             = require('bboxed')
var cheerio            = require('cheerio');
var fsp                = require('fs-promise');
var fsp_extra          = require('fs-promise'); // fs-extra wrapped in promise
var http               = require('http');
var url                = require("url");
var temp               = require('temp');
var express            = require('express');
var morgan             = require('morgan');
var errorhandler       = require('errorhandler')
var serve_static       = require('serve-static');
var Q                  = require('q');
var path               = require('path');

var fimfic = require('./lib/fimfic');
var ebook = require('./lib/ebook');

var storiesCached = {};
var cacheDir = temp.mkdirSync("downloaded-epubs");
console.log("Using cacheDir:", cacheDir)
Q.longStackSupport = true;
var app = express();
var server = http.createServer(app);

app.set('port', process.env.PORT || 4100);
if ('development' == app.get('env')) {
    app.use(morgan('dev'));
    app.use(errorhandler());
}
app.use(serve_static('public'))

// This param will only add the extension to the req object.
// The filename itself is NOT used.
//
// The following are thus equal are will return the same response:
// example.com/book/9/download/book.epub
// example.com/book/9/download/the-greatest-equine-who-has-ever-lived.epub
app.param('filename', function(req, res, next, filename) {
    var extension = path.extname(filename)
    if(extension)
    {
        var validExtension = false;
        if(extension == '.epub')
            validExtension = true;
        if(extension == '.mobi')
            validExtension = true;
        
        if(validExtension)
        {
            req.extension = extension;
            next();
        }
        else
        {
            res.status(400);
            res.set('Content-Type', 'text/plain'); // XXX: Throwing a error in next line overrides this.
            next(new Error('The extension '+extension+' is not supported. This server is case sensitive. Contact a administrator if you would like this extension to be supported.'));
        }
    }
    else
    {
        res.status(400);
        res.set('Content-Type', 'text/plain'); // XXX: Throwing a error in next line overrides this.
        next(new Error('No extension.'));
    }
});

app.param('book_id', function(req, res, next, book_id) {
    book_id = parseInt(book_id, 10)
    if( book_id )
    {
        req.book_id = +book_id;
        next();
    }
    else
        next(new Error('Invalid book id.'));
});

var uploadFile = function(res, filename) {
    var deferred = Q.defer();
    res.sendfile( filename, { maxAge:1000*60*60*24*7 }, function(err){
        if(err)
            deferred.reject( err );
        else
            deferred.resolve(filename);
    });
    return deferred.promise;
};

// This function assumes the ebook already exist
var serveBook = function(res, extension, book_dir) {
    return uploadFile(res, path.join(book_dir, "processed"+extension))
}

// Bust the cache
app.get('/book/:book_id/bust_cache', function(req, res){

    var storyID = req.book_id;
    var book_dir = path.join(cacheDir, String(storyID));
    
    res.set('Content-Type', 'text/plain');
    if (storiesCached.hasOwnProperty(storyID))
    {
        if (storiesCached[storyID] !== false)
        {
            fsp_extra.remove( book_dir )
            .then( function(){ delete storiesCached[storyID] } )
            .then( function(){ res.send('Done') } )
            .done()
        }
        else
        {
            res.send(500, '500 Internal Server Error: Book exist in a invalid state. Try waiting.');
        }
    }
    else
    {
        res.send(412, '412 Precondition Failed: Book is not yet cached');
    }
})

app.get('/book/:book_id/download/:filename', function(req, res){
    
    // In OPDS world we call them books.
    // In fimfic world we call them stories.
    // But they are just the same things.
    var storyID = req.book_id;
    var book_dir = path.join(cacheDir, String(storyID));
    
    if(storiesCached[storyID] === true)
    {
        // console.log("Cache hit for story",storyID);
        serveBook(res, req.extension, book_dir)
        .catch(function (err) {
            console.error(err);
            res.set('Content-Type', 'text/plain');
            if(err.errno == 34)
                res.send(404, 'File does not exist' );
            else
                res.send(500, 'Could not send you the requested file: '+err.message );
            delete storiesCached[storyID];
        })
        .done();
    }
    else if (storiesCached[storyID] === false)
    {
        // The story is being processed by another request.
        res.writeHead(429, {'Content-Type': 'text/plain'});
        res.write("429, Too Many Requests. The story is being processed. Please try again in a few seconds. Huge ebooks with lots of images may take a minute or more. Contact administrator if error persists.");
        res.end();
    }
    else if (storiesCached[storyID])
    {
        // The story was never successfully processed by another request.
        res.writeHead(503, {'Content-Type': 'text/plain'});
        res.write("503, Service Unavailable. We tried to process this ebook at a earlier time but failed at that time: " + storiesCached[storyID].message );
        res.end();
    }
    else
    {
        storiesCached[storyID] = false;
        
        fsp.mkdir( book_dir )
        .then( function() { return fsp.mkdir( path.join(book_dir,"images"))} )
        .then( function() { return fimfic.downloadStory(storyID, path.join(book_dir, "from_fimfic.html"))} )
        .then( function() { return ebook.embedImages_html(path.join(book_dir, "from_fimfic.html"), path.join(book_dir, "embed_images.html"))} )
        .then( function() { return fimfic.getmetadata(storyID)} )
        .then( function(story) {
                var promises = []
                
                // Here we call going to call ebook-convert
                // See the following link for possible arguments:
                // http://manual.calibre-ebook.com/cli/ebook-convert.html
                
                var args = []
                args.push('--max-toc-links',"0")
                var cover = undefined
                cover = story.full_image ? url.resolve("https://www.fimfiction.net/", story.full_image) : undefined
                cover = cover ? cover : ( story.image ? url.resolve("https://www.fimfiction.net/", story.image) : undefined)
                if(cover)
                {
                    args.push('--cover', cover)
                }
                args.push('--publisher', 'https://www.fimfiction.net/')
                args.push('--authors', story.author.name)
                
                // story.description is bbcode. But we need plain text.
                // So we first convert it to html using bboxed.
                // And then we convert the html to plain text using cheerio.
                args.push('--comments', cheerio.load(bboxed(normalize_newline(story.description))).root().text() )
                
                var categories = []
                for(var category in story.categories) {
                    if(story.categories[category])
                    {
                        categories.push(category)
                    }
                }
                if(categories.length > 0)
                {
                    args.push('--tags',categories.join(','))
                }
                args.push('--title',story.title)
                
                promises.push( ebook.convert(path.join(book_dir, "embed_images.html"), path.join(book_dir, "processed.epub"), args) )
                promises.push( ebook.convert(path.join(book_dir, "embed_images.html"), path.join(book_dir, "processed.mobi"), args) )
                return Q.all(promises)
             })
        .then( function() {
            storiesCached[storyID] = true;
            console.log("Story",storyID,"succesfully cached")
            
            serveBook(res, req.extension, book_dir)
            .catch(function (err) {
                console.error(err);
                res.set('Content-Type', 'text/plain');
                if(err.errno == 34)
                    res.send(404, 'File does not exist' );
                else
                    res.send(500, 'Could not send you the requested file: '+err.message );
            })
            .done()
            
            // TODO: Remove temporarily files used in the conversion/extraction process.
        })
        .catch(function (err) {
            console.error(err);
            res.set('Content-Type', 'text/plain');
            res.send(500, 'Could not process the file: '+err.message );
            storiesCached[storyID] = err;
        })
        .done()
    }
    
});

server.listen(app.get('port'), function(){
    console.log('Express server listening on port ' + app.get('port'));
});

