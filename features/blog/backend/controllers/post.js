'use strict';

let slug = require('slug');
let _ = require('arrowjs')._;
let Promise = require('arrowjs').Promise;
let logger = require('arrowjs').logger;

module.exports = function (controller, component, app) {

    let itemOfPage = app.getConfig('pagination').numberItem || 10;
    let isAllow = ArrowHelper.isAllow;
    let baseRoute = '/admin/blog/posts/';
    let allPermissions = 'post_manage_all';

    function getErrorMsg(err, oldData, newData) {
        logger.error(err);

        let errorMsg = 'Name: ' + err.name + '<br />' + 'Message: ' + err.message;

        if (err.name == ArrowHelper.UNIQUE_ERROR) {
            for (let i in err.errors) {
                if (oldData && oldData._previousDataValues)
                    newData[err.errors[i].path] = oldData._previousDataValues[err.errors[i].path];
                else
                    newData[err.errors[i].path] = '';
            }

            errorMsg = 'A post with the alias provided already exists';
        }

        return errorMsg;
    }

    function convertCategoriesToArray(str) {
        str = str.split(':');
        str.shift();
        str.pop(str.length - 1);
        return str;
    }

    function updateCategoryCount(post) {
        if (post.published) {
            let categories = post.categories;

            if (categories) {
                categories = convertCategoriesToArray(categories);

                // Increase count of each category in array
                return Promise.map(categories, function (id) {
                    return app.feature.category.actions.findById(id).then(function (category) {
                        if (category) {
                            let count = +category.count + 1;
                            return app.feature.category.actions.update(category, {
                                count: count
                            });
                        } else {
                            return null;
                        }
                    });
                });
            } else {
                return null;
            }
        } else {
            return null;
        }
    }

    function updatePost(post, data) {
        // Union categories before and after edit
        let categories = post.categories ? convertCategoriesToArray(post.categories) : [];
        let newCategories = data.categories ? convertCategoriesToArray(data.categories) : [];
        let needUpdate = _.union(categories, newCategories);

        return app.feature.blog.actions.update(post, data).then(function () {
            // Update categories
            return Promise.map(needUpdate, function (id) {
                let updateCountQuery = `UPDATE arr_category
                                        SET count = (
                                                SELECT count(id)
                                                FROM arr_post
                                                WHERE categories LIKE '%:${id}:%' AND type = 'post' AND published = 1
                                            )
                                        WHERE id = ${id}`;
                return app.models.rawQuery(updateCountQuery);
            });
        });
    }

    controller.postList = function (req, res) {
        // Get current page and default sorting
        var page = req.params.page || 1;

        // Add buttons and check authorities
        let toolbar = new ArrowHelper.Toolbar();
        toolbar.addRefreshButton(baseRoute);
        toolbar.addSearchButton('true');
        toolbar.addCreateButton(isAllow(req, 'post_manage'), baseRoute + 'create');
        toolbar.addDeleteButton(isAllow(req, 'post_manage'));
        toolbar = toolbar.render();

        // Config columns
        let tableStructure = [
            {
                column: "id",
                width: '1%',
                header: "",
                type: 'checkbox'
            },
            {
                column: 'title',
                width: '25%',
                header: __('all_table_column_title'),
                link: baseRoute + '{id}',
                filter: {
                    data_type: 'string'
                }
            },
            {
                column: 'alias',
                width: '25%',
                header: __('all_table_column_alias'),
                filter: {
                    data_type: 'string'
                }
            },
            {
                column: 'user.display_name',
                width: '20%',
                header: __('all_table_column_author'),
                filter: {
                    data_type: 'string',
                    filter_key: 'user.display_name'
                }
            },
            {
                column: 'created_at',
                width: '15%',
                header: __('m_blog_backend_page_filter_column_created_date'),
                type: 'datetime',
                filter: {
                    data_type: 'datetime',
                    filter_key: 'created_at'
                }
            },
            {
                column: 'published',
                width: '10%',
                header: __('all_table_column_status'),
                type: 'custom',
                alias: {
                    "1": "Publish",
                    "0": "Draft"
                },
                filter: {
                    type: 'select',
                    filter_key: 'published',
                    data_source: [
                        {
                            name: 'Publish',
                            value: 1
                        },
                        {
                            name: 'Draft',
                            value: 0
                        }
                    ],
                    display_key: 'name',
                    value_key: 'value'
                }
            }
        ];

        // Check permissions view all posts
        let customCondition = " AND type='post'";
        if (req.permissions.indexOf(allPermissions) == -1) customCondition += " AND created_by = " + req.user.id;

        let filter = ArrowHelper.createFilter(req, res, tableStructure, {
            rootLink: baseRoute + 'page/$page/sort',
            limit: itemOfPage,
            customCondition: customCondition,
            backLink: 'post_back_link'
        });

        // Find all posts
        app.feature.blog.actions.findAndCountAll({
            where: filter.conditions,
            include: [
                {
                    model: app.models.user,
                    attributes: ['display_name'],
                    where: ['1 = 1']
                }
            ],
            order: filter.order,
            limit: filter.limit,
            offset: (page - 1) * itemOfPage
        }).then(function (results) {
            let totalPage = Math.ceil(results.count / itemOfPage);

            // Replace title of no-title post
            let items = results.rows;
            items.map(function (item) {
                if (!item.dataValues.title) item.dataValues.title = '(no title)';
            });

            // Render view
            res.backend.render('post/index', {
                title: __('m_blog_backend_post_render_title'),
                totalPage: totalPage,
                items: items,
                currentPage: page,
                toolbar: toolbar,
                queryString: (req.url.indexOf('?') == -1)?'':('?'+req.url.split('?').pop())
            });
        }).catch(function (err) {
            logger.error(err);
            req.flash.error('Name: ' + err.name + '<br />' + 'Message: ' + err.message);

            // Render view if has error
            res.backend.render('post/index', {
                title: __('m_blog_backend_post_render_title'),
                totalPage: 1,
                items: null,
                currentPage: page,
                toolbar: toolbar,
                queryString: (req.url.indexOf('?') == -1)?'':('?'+req.url.split('?').pop())
            });
        });
    };

    controller.postCreate = function (req, res) {
        let toolbar = new ArrowHelper.Toolbar();
        toolbar.addBackButton(req, 'post_back_link');
        toolbar.addSaveButton(isAllow(req, 'post_manage'));

        app.feature.category.actions.findAll({
            where: {
                type: 'post'
            },
            order: 'name ASC'
        }).then(function (categories) {
            res.backend.render('post/new', {
                title: __('m_blog_backend_post_render_create'),
                categories: categories,
                toolbar: toolbar.render()
            });
        }).catch(function (err) {
            req.flash.error('Name: ' + err.name + '<br />' + 'Message: ' + err.message);
            res.redirect(baseRoute);
        });
    };

    controller.postSave = function (req, res, next) {
        let data = req.body;
        data.created_by = req.user.id;
        let post_id = 0;
        let oldPost;

        // Create post
        app.feature.blog.actions.create(data, 'post').then(function (post) {
            post_id = post.id;
            oldPost = post;

            // Update count of categories if post is published
            return updateCategoryCount(post);
        }).then(function (a) {
            req.flash.success(__('m_blog_backend_post_flash_create_success'));
            res.redirect(baseRoute + post_id);
        }).catch(function (err) {
            req.flash.error(getErrorMsg(err, oldPost, data));
            res.locals.post = data;
            next();
        });
    };

    controller.postView = function (req, res) {
        let post = req.post;

        // Check permissions
        if (req.permissions.indexOf(allPermissions) == -1 && post.created_by != req.user.id) {
            req.flash.error("You do not have permission to manage this post");
            return next();
        }

        // Add buttons
        let toolbar = new ArrowHelper.Toolbar();
        toolbar.addBackButton(req, 'post_back_link');
        toolbar.addSaveButton(isAllow(req, 'post_manage'));
        toolbar.addDeleteButton(isAllow(req, 'post_manage'));

        // Find all categories
        app.feature.category.actions.findAll({
            where: {
                type: 'post'
            },
            order: 'id ASC'
        }).then(function (categories) {
            // Add preview button
            toolbar.addGeneralButton(isAllow(req, 'post_index'), 'Preview', baseRoute + 'preview/' + post.id,
                {
                    icon: '<i class="fa fa-eye"></i>',
                    buttonClass: 'btn btn-info',
                    target: '_blank'
                });

            // Render view
            res.backend.render('post/new', {
                title: __('m_blog_backend_post_render_update'),
                categories: categories,
                post: post,
                toolbar: toolbar.render()
            });
        }).catch(function (err) {
            logger.error(err);
            req.flash.error('Name: ' + err.name + '<br />' + 'Message: ' + err.message);
            res.redirect(baseRoute);
        });
    };

    controller.postUpdate = function (req, res, next) {
        let post = req.post;

        // Check permissions
        if (req.permissions.indexOf(allPermissions) == -1 && post.created_by != req.user.id) {
            req.flash.error("You do not have permission to manage this post");
            return next();
        }

        let data = req.body;

        updatePost(post, data).then(function () {
            req.flash.success(__('m_blog_backend_post_flash_update_success'));
            res.redirect(baseRoute + req.params.postId);
        }).catch(function (err) {
            req.flash.error(getErrorMsg(err, post, data));
            res.locals.post = data;
            next();
        });
    };

    controller.postPreview = function (req, res) {
        if (req.post) {
            // Render frontend view
            res.frontend.render('post', {
                post: req.post
            });
        } else {
            // Redirect to 404 if post not exist
            res.frontend.render('_404');
        }
    };

    controller.postAutosave = function (req, res) {
        let data = req.body;
        let author = req.user.id;

        if (data.post_id) {
            app.feature.blog.actions.findById(data.post_id).then(function (post) {
                // Check permissions
                if (req.permissions.indexOf(allPermissions) == -1 && post.created_by != author) {
                    return res.jsonp({id: 0});
                }

                updatePost(post, data).then(function () {
                    res.jsonp({id: post.id});
                }).catch(function (err) {
                    logger.error(err);
                    res.jsonp({id: 0});
                });
            })
        } else {
            data.created_by = author;
            let newPost;

            // Create post
            app.feature.blog.actions.create(data, 'post').then(function (post) {
                newPost = post;
                // Update count of categories if post is published
                return updateCategoryCount(post);
            }).then(function () {
                if (newPost && newPost.id)
                    res.jsonp({id: post.id});
                else
                    res.jsonp({id: 0});
            }).catch(function (err) {
                logger.error(err);
                res.jsonp({id: 0});
            })
        }
    };

    controller.postDelete = function (req, res) {
        let ids = req.body.ids.split(',');
        let categoryAction = app.feature.category.actions;

        app.feature.blog.actions.findAll({
            where: {
                id: {
                    $in: ids
                }
            }
        }).then(function (posts) {
            // Decrease count of categories
            return Promise.map(posts, function (post) {
                // Recheck permissions to prevent user access by ajax
                if (req.permissions.indexOf(allPermissions) == -1 && post.created_by != req.user.id) {
                    return null;
                }

                let categories = post.categories ? convertCategoriesToArray(post.categories) : [];
                if (categories.length > 0) {
                    return Promise.map(categories, function (id) {
                        return categoryAction.findById(id).then(function (category) {
                            let count = +category.count - 1;
                            return categoryAction.update(category, {count: count});
                        })
                    });
                } else {
                    return null;
                }
            });
        }).then(function () {
            // Delete post
            if (req.permissions.indexOf(allPermissions) == -1 && post.created_by != req.user.id) {
                return null;
            } else {
                return app.feature.blog.action.destroy(ids);
            }
        }).then(function () {
            req.flash.success(__('m_blog_backend_post_flash_delete_success'));
            res.sendStatus(200);
        }).catch(function (err) {
            logger.error(err);
            req.flash.error('Name: ' + err.name + '<br />' + 'Message: ' + err.message);
            res.sendStatus(200);
        });
    };

    controller.postRead = function (req, res, next, id) {
        app.feature.blog.actions.findById(id).then(function (post) {
            req.post = post;
            next();
        });
    };

    /**
     * Return data to create frontend menu (used in menu module)
     */
    controller.linkMenuPost = function (req, res) {
        let page = req.query.page;
        let searchText = req.query.searchStr;

        let conditions = "type='post' AND published = 1";
        if (searchText != '') conditions += " AND title like '%" + searchText.toLowerCase() + "%'";

        // Find all posts with page and search keyword
        app.models.post.findAndCount({
            attributes: ['id', 'alias', 'title'],
            where: [conditions],
            limit: itemOfPage,
            offset: (page - 1) * itemOfPage,
            raw: true
        }).then(function (results) {
            let totalRows = results.count;
            let items = results.rows;
            let totalPage = Math.ceil(results.count / itemOfPage);

            // Send json response
            res.jsonp({
                totalRows: totalRows,
                totalPage: totalPage,
                items: items,
                title_column: 'title',
                link_template: '/blog/posts/{id}/{alias}'
            });
        });
    }
};