# Join words

The join dictionary has 1,600 distinct English words. Each phrase samples three words independently with Node's `crypto.randomInt`. The phrase has about 31.93 bits of entropy. It is a join locator; a verified allowed work domain is still required.

The words come from the [EFF large word list](https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt). The selection keeps lowercase words of three to nine letters. It excludes plural endings and a conservative list of offensive or sensitive terms. [CMUdict](https://github.com/cmusphinx/cmudict) supplies pronunciations; the selection excludes duplicate pronunciations after stress marks are removed. The first 1,600 eligible words form the fixed dictionary.

Keep the dictionary stable. Retired phrases remain reserved in the database, including after rotation. Generation never uses a seeded or non-cryptographic random source.
