package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/service"
)

func RegisterTheatreRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/theatre/works", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 12)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.TheatreWorks(user.ID, c.Query("q"), c.Query("mine") == "true", page, pageSize, c.Query("kind"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/theatre/works/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.TheatreWorkDetail(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})
	r.GET("/theatre/works/:id/episodes/:episodeID/video", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		delivery, err := svc.PrepareTheatreEpisodeDelivery(user.ID, c.Param("id"), c.Param("episodeID"), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, delivery, "private, no-store", "")
	})
	r.POST("/theatre/works", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.TheatreWorkRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		work, err := svc.CreateTheatreWork(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"work": work})
	})
	r.PATCH("/theatre/works/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.TheatreWorkRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.UpdateTheatreWork(user.ID, c.Param("id"), req); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.DELETE("/theatre/works/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteTheatreWork(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.GET("/theatre/works/:id/video", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		delivery, err := svc.PrepareTheatreDelivery(user.ID, c.Param("id"), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, delivery, "private, no-store", "")
	})
	r.GET("/theatre/works/:id/cover", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		delivery, err := svc.PrepareTheatreCoverDelivery(user.ID, c.Param("id"), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, delivery, "private, no-store", "")
	})
}
