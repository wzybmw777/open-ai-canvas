package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"yingce/backend/internal/service"
)

func registerAdminChannelSyncRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/channel-sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		jobs, err := svc.AdminChannelSyncJobs(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"jobs": jobs, "timezone": "Asia/Shanghai", "schedule": "00:00"})
	})
	r.PUT("/admin/channel-sync/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.ChannelSyncRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		job, err := svc.SaveAdminChannelSync(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"job": job})
	})
	r.POST("/admin/channel-sync/:id/run", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		run, err := svc.RunAdminChannelSync(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"run": run})
	})
	r.GET("/admin/channel-sync/:id/runs", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		runs, err := svc.AdminChannelSyncRuns(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"runs": runs})
	})
}
