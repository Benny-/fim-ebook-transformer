fim-ebook-transformer
=======================

Web service to download ebooks from `fimfiction.net <https://www.fimfiction.net/>`_. It embeds any external images and runs calibre to remove any errors in the ebook. A sample service might be running on http://vps.bennyjacobs.nl:4100/

Dependecies
------------

This program is written in JavaScript and requires NodeJS.

This program requires the following external programs in your path:

- unzip
- tidy
- zip
- ebook-convert (part of calibre)

Installation and running
------------

Installing and downloading dependencies:

.. code:: bash

    npm install

Running:

.. code:: bash

    npm start

Known issues
------------

- A express request timeouts after 2 minutes. This happens while converting a huge ebook.
- A ebook is converted to a .epub and a .mobi regardless if only one of the two was requested.
- It is slow. (ebook-convert is CPU bound, multiple cores help when converting multiple ebooks)

