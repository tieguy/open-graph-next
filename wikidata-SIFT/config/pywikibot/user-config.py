# pywikibot user configuration
# https://www.mediawiki.org/wiki/Manual:Pywikibot/user-config.py

family = 'wikidata'
mylang = 'wikidata'

usernames['wikidata']['wikidata'] = 'LuisVilla'
usernames['wikidata']['test'] = 'LuisVilla'

# Use bot password authentication
password_file = 'user-password.py'

# Identify the bot properly per Wikimedia User-Agent policy
# https://meta.wikimedia.org/wiki/User-Agent_policy
user_agent_format = 'wikidata-SIFT/0.1 (https://github.com/luisVilla; luisvilla@wikidata) {script} Pywikibot/{pwb} Python/{python}'

# Read-only operations against production are fine;
# writes target test.wikidata.org only.

# Disable maxlag check — WDQS lag can be hours but doesn't affect
# our read-only recentchanges/entity fetching operations.
# Re-enable if we ever do write operations against production.
maxlag = 0
